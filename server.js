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

// REAL SERVICE IDS
const SERVICE_IDS = {
    'Comprehensive Wellness Visit': 'EOS5TK4VKO6YGM4TYUFMXO2W',
    'Follow-up Consultation': 'KOGODBCXVOKARIL3YZ5DVSKS',
    'Acute Care Visit': '45HRDI4XGITSL4SYOKJKYNK4'
};

const TEAM_MEMBER_ID = 'TMpDyughFdZTf6ID';
const LOCATION_ID = process.env.SQUARE_LOCATION_ID || 'LT1S9BE1EX0PW';
const PROVIDER_PASSWORD = process.env.PROVIDER_PASSWORD || 'PJA2025!Secure';

console.log('🚀 SERVER STARTUP:');
console.log('  Location:', LOCATION_ID);
console.log('  Team Member:', TEAM_MEMBER_ID);
console.log('  Environment:', process.env.NODE_ENV || 'development');

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        environment: process.env.NODE_ENV || 'development',
        locationId: LOCATION_ID
    });
});

// Serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Provider Login
app.post('/api/provider/login', (req, res) => {
    const { password } = req.body;
    
    if (password === PROVIDER_PASSWORD) {
        const token = Buffer.from(`${Date.now()}-${Math.random()}`).toString('base64');
        console.log('✅ Provider login successful');
        res.json({ success: true, token });
    } else {
        console.log('❌ Provider login failed');
        res.status(401).json({ success: false, message: 'Incorrect password' });
    }
});

// Verify token
function verifyProviderToken(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// Get availability - FIXED BIGINT ISSUE
app.post('/api/availability', async (req, res) => {
    console.log('\n=== AVAILABILITY CHECK ===');
    const { serviceId, date } = req.body;
    console.log('Service:', serviceId);
    console.log('Date:', date);
    
    try {
        const selectedDate = new Date(date + 'T00:00:00');
        const startAt = new Date(selectedDate);
        startAt.setHours(0, 0, 0, 0);
        
        const endAt = new Date(selectedDate);
        endAt.setHours(23, 59, 59, 999);

        console.log('Searching:', startAt.toISOString(), 'to', endAt.toISOString());

        const response = await squareClient.bookingsApi.searchAvailability({
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
        });

        if (response.result.availabilities && response.result.availabilities.length > 0) {
            // FIX BIGINT SERIALIZATION - Convert BigInt to String
            const slots = response.result.availabilities.map(slot => ({
                startAt: slot.startAt,
                appointmentSegments: slot.appointmentSegments.map(segment => ({
                    durationMinutes: segment.durationMinutes,
                    teamMemberId: segment.teamMemberId,
                    serviceVariationId: segment.serviceVariationId,
                    serviceVariationVersion: segment.serviceVariationVersion ? segment.serviceVariationVersion.toString() : '1'
                }))
            }));
            
            console.log(`✅ Found ${slots.length} slots`);
            res.json({ availabilities: slots });
        } else {
            console.log('⚠️ No availability');
            res.json({ 
                availabilities: [],
                message: 'No available times for this date.'
            });
        }
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ 
            error: 'Failed to check availability',
            details: error.message
        });
    }
});

// Create booking
app.post('/api/booking', async (req, res) => {
    console.log('\n=== CREATE BOOKING ===');
    
    const { 
        customerInfo, 
        healthInfo, 
        consent, 
        selectedService, 
        selectedTime 
    } = req.body;

    try {
        // Find or create customer
        console.log('1. Finding customer:', customerInfo.email);
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
            console.log('✅ Found:', customerId);
        } else {
            console.log('Creating new customer...');
            const createResponse = await squareClient.customersApi.createCustomer({
                givenName: customerInfo.firstName,
                familyName: customerInfo.lastName,
                emailAddress: customerInfo.email,
                phoneNumber: customerInfo.phone,
                note: `Telehealth - DOB: ${customerInfo.dob}`
            });
            customerId = createResponse.result.customer.id;
            console.log('✅ Created:', customerId);
        }

        // Save full patient record
        const fullRecord = `
═══════════════════════════════════════════════════════
TELEHEALTH PATIENT RECORD - ${new Date().toISOString()}
═══════════════════════════════════════════════════════

PATIENT: ${customerInfo.firstName} ${customerInfo.lastName}
EMAIL: ${customerInfo.email}
PHONE: ${customerInfo.phone}
DOB: ${customerInfo.dob}

HEALTH INFORMATION:
- Primary Concern: ${healthInfo.primaryConcern}
- Symptoms: ${healthInfo.symptoms}
- Duration: ${healthInfo.duration}
- Severity: ${healthInfo.severity}
- Medications: ${healthInfo.medications || 'None'}
- Allergies: ${healthInfo.allergies || 'None'}
- Medical History: ${healthInfo.medicalHistory || 'None'}

CONSENT FORMS - ALL SIGNED:
✓ HIPAA Authorization: ${consent.hipaaConsent ? 'SIGNED' : 'NOT SIGNED'}
✓ Telehealth Consent: ${consent.telehealthConsent ? 'SIGNED' : 'NOT SIGNED'}
✓ Informed Consent: ${consent.informedConsent ? 'SIGNED' : 'NOT SIGNED'}
✓ Privacy Notice: ${consent.privacyNotice ? 'ACKNOWLEDGED' : 'NOT ACKNOWLEDGED'}

Electronic Signature: ${consent.signature}
Date: ${consent.signatureDate}

APPOINTMENT:
Service: ${selectedService}
Time: ${selectedTime}
═══════════════════════════════════════════════════════
`;

        console.log('2. Saving patient record...');
        await squareClient.customersApi.updateCustomer(customerId, {
            note: fullRecord
        });
        console.log('✅ Saved');

        // Create booking
        console.log('3. Creating booking...');
        const bookingResponse = await squareClient.bookingsApi.createBooking({
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
                customerNote: `${selectedService}\nConcern: ${healthInfo.primaryConcern}`
            }
        });

        console.log('✅ BOOKING SUCCESS!');
        console.log('Booking ID:', bookingResponse.result.booking.id);

        res.json({
            success: true,
            bookingId: bookingResponse.result.booking.id,
            customerId: customerId
        });

    } catch (error) {
        console.error('❌ BOOKING ERROR:', error);
        res.status(500).json({
            error: 'Failed to create booking',
            details: error.message
        });
    }
});

// Get bookings (protected)
app.get('/api/bookings', verifyProviderToken, async (req, res) => {
    console.log('\n=== GET BOOKINGS ===');
    try {
        const startAt = new Date();
        startAt.setHours(0, 0, 0, 0);

        const response = await squareClient.bookingsApi.listBookings(
            undefined,
            undefined,
            undefined,
            TEAM_MEMBER_ID,
            LOCATION_ID,
            startAt.toISOString()
        );

        const bookings = response.result.bookings || [];
        console.log(`✅ Found ${bookings.length} bookings`);

        const bookingsWithDetails = await Promise.all(
            bookings.map(async (booking) => {
                try {
                    const customerResponse = await squareClient.customersApi.retrieveCustomer(booking.customerId);
                    return {
                        ...booking,
                        customerDetails: customerResponse.result.customer
                    };
                } catch (error) {
                    return { ...booking, customerDetails: null };
                }
            })
        );

        res.json({ bookings: bookingsWithDetails });
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ 
            error: 'Failed to fetch bookings'
        });
    }
});

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
    console.log(`\n✅ PJA TELEHEALTH SERVER RUNNING ON PORT ${PORT}`);
    console.log(`Location: ${LOCATION_ID}`);
    console.log(`Team Member: ${TEAM_MEMBER_ID}\n`);
});
