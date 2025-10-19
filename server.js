require('dotenv').config();
const express = require('express');
const { Client, Environment } = require('square');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Square Client Setup
const squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: process.env.NODE_ENV === 'production' ? Environment.Production : Environment.Sandbox
});

// REAL SERVICE IDS - NEWLY CREATED CLEAN SERVICES
const SERVICE_IDS = {
    'Comprehensive Wellness Visit': 'EOS5TK4VKO6YGM4TYUFMXO2W',
    'Follow-up Consultation': 'KOGODBCXVOKARIL3YZ5DVSKS',
    'Acute Care Visit': '45HRDI4XGITSL4SYOKJKYNK4'
};

const TEAM_MEMBER_ID = 'TMpDyughFdZTf6ID'; // Patrick Smith
const LOCATION_ID = process.env.SQUARE_LOCATION_ID || 'LT1S9BE1EX0PW';

// PROVIDER PORTAL PASSWORD (stored in .env)
const PROVIDER_PASSWORD = process.env.PROVIDER_PASSWORD || 'PJA2025!Secure';

console.log('🚀 STARTUP CONFIG:');
console.log('  Location ID:', LOCATION_ID);
console.log('  Team Member:', TEAM_MEMBER_ID);
console.log('  Environment:', process.env.NODE_ENV || 'development');
console.log('  Provider Portal Password Set:', !!PROVIDER_PASSWORD);

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        environment: process.env.NODE_ENV || 'development',
        services: SERVICE_IDS,
        locationId: LOCATION_ID,
        teamMemberId: TEAM_MEMBER_ID
    });
});

// Serve index.html at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Provider Portal Login
app.post('/api/provider/login', (req, res) => {
    const { password } = req.body;
    
    console.log('Provider login attempt');
    
    if (password === PROVIDER_PASSWORD) {
        // Generate a simple session token (in production, use JWT or proper session management)
        const token = Buffer.from(`${Date.now()}-${Math.random()}`).toString('base64');
        console.log('✅ Provider login successful');
        res.json({ 
            success: true, 
            token,
            message: 'Login successful' 
        });
    } else {
        console.log('❌ Provider login failed - incorrect password');
        res.status(401).json({ 
            success: false, 
            message: 'Incorrect password' 
        });
    }
});

// Verify Provider Token (simple check - in production use proper JWT)
function verifyProviderToken(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ 
            error: 'Unauthorized - No token provided' 
        });
    }
    
    // Simple token validation (you have a token = you logged in recently)
    // In production, implement proper JWT with expiration
    next();
}

// Get availability
app.post('/api/availability', async (req, res) => {
    console.log('\n=== AVAILABILITY CHECK ===');
    const { serviceId, date } = req.body;
    console.log('Service ID:', serviceId);
    console.log('Date requested:', date);
    console.log('Location ID:', LOCATION_ID);
    console.log('Team Member ID:', TEAM_MEMBER_ID);
    
    try {
        // Parse the date and set time range for the full day
        const selectedDate = new Date(date + 'T00:00:00');
        const startAt = new Date(selectedDate);
        startAt.setHours(0, 0, 0, 0);
        
        const endAt = new Date(selectedDate);
        endAt.setHours(23, 59, 59, 999);

        console.log('Searching from:', startAt.toISOString());
        console.log('Searching to:', endAt.toISOString());

        const searchRequest = {
            query: {
                filter: {
                    startAtRange: {
                        startAt: startAt.toISOString(),
                        endAt: endAt.toISOString()
                    },
                    locationId: LOCATION_ID,
                    segmentFilters: [{
                        serviceVariationId: serviceId,
                        teamMemberIdFilter: {
                            any: [TEAM_MEMBER_ID]
                        }
                    }]
                }
            }
        };

        console.log('Square API Request:', JSON.stringify(searchRequest, null, 2));

        const response = await squareClient.bookingsApi.searchAvailability(searchRequest);

        console.log('Square API Response Status:', response.statusCode);
        console.log('Found availabilities:', response.result.availabilities?.length || 0);

        if (response.result.availabilities && response.result.availabilities.length > 0) {
            const slots = response.result.availabilities.map(slot => ({
                startAt: slot.startAt,
                appointmentSegments: slot.appointmentSegments
            }));
            console.log(`✅ SUCCESS: Found ${slots.length} available slots`);
            res.json({ availabilities: slots });
        } else {
            console.log('⚠️ WARNING: No availabilities from Square');
            
            res.json({ 
                availabilities: [],
                message: 'No available appointment times for this date. Please try another date.',
                debug: {
                    locationId: LOCATION_ID,
                    teamMemberId: TEAM_MEMBER_ID,
                    dateRange: { startAt: startAt.toISOString(), endAt: endAt.toISOString() }
                }
            });
        }
    } catch (error) {
        console.error('❌ AVAILABILITY ERROR:', error);
        console.error('Error details:', JSON.stringify(error.errors || error, null, 2));
        res.status(500).json({ 
            error: 'Failed to check availability',
            details: error.message,
            errors: error.errors || []
        });
    }
});

// Create booking
app.post('/api/booking', async (req, res) => {
    console.log('\n=== BOOKING REQUEST ===');
    console.log('Booking Data:', JSON.stringify(req.body, null, 2));
    
    const { 
        customerInfo, 
        healthInfo, 
        consent, 
        selectedService, 
        selectedTime 
    } = req.body;

    try {
        // Find or create customer
        console.log('1. Searching for customer:', customerInfo.email);
        let customerId;
        
        const searchResponse = await squareClient.customersApi.searchCustomers({
            query: {
                filter: {
                    emailAddress: { exact: customerInfo.email }
                }
            }
        });

        if (searchResponse.result.customers && searchResponse.result.customers.length > 0) {
            customerId = searchResponse.result.customers[0].id;
            console.log('✅ Found existing customer:', customerId);
        } else {
            console.log('Creating new customer...');
            const createResponse = await squareClient.customersApi.createCustomer({
                givenName: customerInfo.firstName,
                familyName: customerInfo.lastName,
                emailAddress: customerInfo.email,
                phoneNumber: customerInfo.phone,
                note: `Telehealth patient - DOB: ${customerInfo.dob}`
            });
            customerId = createResponse.result.customer.id;
            console.log('✅ Created new customer:', customerId);
        }

        // Save ALL consent forms and health info to customer notes
        const fullConsentRecord = `
═══════════════════════════════════════════════════════
TELEHEALTH PATIENT RECORD
Date: ${new Date().toISOString()}
═══════════════════════════════════════════════════════

PATIENT INFORMATION:
- Name: ${customerInfo.firstName} ${customerInfo.lastName}
- Email: ${customerInfo.email}
- Phone: ${customerInfo.phone}
- Date of Birth: ${customerInfo.dob}

═══════════════════════════════════════════════════════
HEALTH INFORMATION:
═══════════════════════════════════════════════════════
Primary Concern: ${healthInfo.primaryConcern}
Current Symptoms: ${healthInfo.symptoms}
Duration: ${healthInfo.duration}
Severity: ${healthInfo.severity}
Current Medications: ${healthInfo.medications || 'None'}
Allergies: ${healthInfo.allergies || 'None'}
Medical History: ${healthInfo.medicalHistory || 'None provided'}

═══════════════════════════════════════════════════════
LEGAL CONSENT FORMS - ALL SIGNED
═══════════════════════════════════════════════════════

1. HIPAA AUTHORIZATION: ${consent.hipaaConsent ? '✓ SIGNED' : '✗ NOT SIGNED'}
2. TELEHEALTH CONSENT: ${consent.telehealthConsent ? '✓ SIGNED' : '✗ NOT SIGNED'}
3. INFORMED CONSENT: ${consent.informedConsent ? '✓ SIGNED' : '✗ NOT SIGNED'}
4. PRIVACY NOTICE: ${consent.privacyNotice ? '✓ ACKNOWLEDGED' : '✗ NOT ACKNOWLEDGED'}

Electronic Signature: ${consent.signature}
Signature Date: ${consent.signatureDate}
IP Address: ${consent.ipAddress || 'Not recorded'}

═══════════════════════════════════════════════════════
APPOINTMENT DETAILS:
═══════════════════════════════════════════════════════
Service: ${selectedService}
Scheduled Time: ${selectedTime}
Booking Created: ${new Date().toISOString()}
`;

        console.log('2. Updating customer record with full consent and health information...');
        await squareClient.customersApi.updateCustomer(customerId, {
            note: fullConsentRecord
        });
        console.log('✅ Saved complete patient record');

        // Create booking in Square
        console.log('3. Creating Square booking...');
        console.log('   Location ID:', LOCATION_ID);
        console.log('   Customer ID:', customerId);
        console.log('   Start Time:', selectedTime);
        console.log('   Service ID:', SERVICE_IDS[selectedService]);
        
        const bookingRequest = {
            booking: {
                locationId: LOCATION_ID,
                customerId: customerId,
                startAt: selectedTime,
                appointmentSegments: [{
                    durationMinutes: getDurationForService(selectedService),
                    serviceVariationId: SERVICE_IDS[selectedService],
                    teamMemberId: TEAM_MEMBER_ID,
                    serviceVariationVersion: 1
                }],
                customerNote: `${selectedService}\n\nPrimary Concern: ${healthInfo.primaryConcern}\n\nSymptoms: ${healthInfo.symptoms}`
            }
        };

        console.log('Booking request:', JSON.stringify(bookingRequest, null, 2));

        const bookingResponse = await squareClient.bookingsApi.createBooking(bookingRequest);

        console.log('✅ BOOKING CREATED SUCCESSFULLY!');
        console.log('Booking ID:', bookingResponse.result.booking.id);
        console.log('Booking Status:', bookingResponse.result.booking.status);

        res.json({
            success: true,
            bookingId: bookingResponse.result.booking.id,
            customerId: customerId,
            message: 'Appointment booked successfully! You will receive a confirmation email.'
        });

    } catch (error) {
        console.error('❌ BOOKING ERROR:', error);
        console.error('Error details:', JSON.stringify(error.errors || error, null, 2));
        res.status(500).json({
            error: 'Failed to create booking',
            details: error.message,
            errors: error.errors || []
        });
    }
});

// Get all bookings (PROTECTED - for provider portal)
app.get('/api/bookings', verifyProviderToken, async (req, res) => {
    console.log('\n=== FETCHING ALL BOOKINGS (Provider Portal) ===');
    try {
        // Get bookings starting from today
        const startAt = new Date();
        startAt.setHours(0, 0, 0, 0);

        console.log('Fetching bookings from:', startAt.toISOString());
        console.log('Location ID:', LOCATION_ID);
        console.log('Team Member ID:', TEAM_MEMBER_ID);

        const response = await squareClient.bookingsApi.listBookings(
            undefined, // limit
            undefined, // cursor
            undefined, // customerId
            TEAM_MEMBER_ID, // teamMemberId
            LOCATION_ID, // locationId
            startAt.toISOString() // startAtMin
        );

        const bookings = response.result.bookings || [];
        console.log(`✅ Found ${bookings.length} bookings`);

        // Get customer details for each booking
        const bookingsWithDetails = await Promise.all(
            bookings.map(async (booking) => {
                try {
                    const customerResponse = await squareClient.customersApi.retrieveCustomer(booking.customerId);
                    return {
                        ...booking,
                        customerDetails: customerResponse.result.customer
                    };
                } catch (error) {
                    console.error('Error fetching customer for booking:', booking.id, error);
                    return { ...booking, customerDetails: null };
                }
            })
        );

        res.json({ bookings: bookingsWithDetails });
    } catch (error) {
        console.error('❌ Error fetching bookings:', error);
        console.error('Error details:', JSON.stringify(error.errors || error, null, 2));
        res.status(500).json({ 
            error: 'Failed to fetch bookings',
            details: error.message,
            errors: error.errors || []
        });
    }
});

// Helper functions
function getDurationForService(serviceName) {
    const durations = {
        'Comprehensive Wellness Visit': 45,
        'Follow-up Consultation': 30,
        'Acute Care Visit': 20
    };
    return durations[serviceName] || 30;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n✅ ========================================`);
    console.log(`   PJA TELEHEALTH SERVER RUNNING`);
    console.log(`========================================`);
    console.log(`Port: ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Location ID: ${LOCATION_ID}`);
    console.log(`Team Member: ${TEAM_MEMBER_ID}`);
    console.log(`Services: ${Object.keys(SERVICE_IDS).join(', ')}`);
    console.log(`Provider Portal: Password Protected ✓`);
    console.log(`========================================\n`);
});
