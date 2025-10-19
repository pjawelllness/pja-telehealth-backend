 require('dotenv').config();
const express = require('express');
const { Client, Environment } = require('square');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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

const TEAM_MEMBER_ID = 'TMpDyughFdZTf6ID';
const LOCATION_ID = process.env.SQUARE_LOCATION_ID;

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        environment: process.env.NODE_ENV || 'development',
        services: SERVICE_IDS
    });
});

// Get availability
app.post('/api/availability', async (req, res) => {
    console.log('=== AVAILABILITY CHECK ===');
    const { serviceId } = req.body;
    console.log('Service ID:', serviceId);
    
    try {
        const startAt = new Date();
        const endAt = new Date();
        endAt.setDate(endAt.getDate() + 14);

        console.log('Searching availability from', startAt.toISOString(), 'to', endAt.toISOString());

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

        console.log('Square Availability Response:', JSON.stringify(response.result, null, 2));

        if (response.result.availabilities && response.result.availabilities.length > 0) {
            const slots = response.result.availabilities.map(slot => ({
                startAt: slot.startAt,
                appointmentSegments: slot.appointmentSegments
            }));
            console.log(`✅ Found ${slots.length} available slots`);
            res.json({ availabilities: slots });
        } else {
            console.log('❌ No availabilities found - returning fallback slots');
            res.json({ 
                availabilities: generateFallbackSlots(startAt, endAt),
                note: 'Using fallback availability - check Square Calendar setup'
            });
        }
    } catch (error) {
        console.error('❌ Availability Check Error:', error);
        res.status(500).json({ 
            error: 'Failed to check availability',
            details: error.message 
        });
    }
});

// Create booking
app.post('/api/booking', async (req, res) => {
    console.log('=== BOOKING REQUEST ===');
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
        console.log('Searching for customer:', customerInfo.email);
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

        // Save consent forms and health info to customer notes
        const consentRecord = `
TELEHEALTH CONSENT FORMS - ${new Date().toISOString()}

HIPAA CONSENT: ${consent.hipaa ? 'AGREED' : 'NOT AGREED'}
TELEHEALTH CONSENT: ${consent.telehealth ? 'AGREED' : 'NOT AGREED'}
SIGNATURE: ${consent.signature}

HEALTH INFORMATION:
Primary Concern: ${healthInfo.primaryConcern}
Symptoms: ${healthInfo.symptoms}
Duration: ${healthInfo.duration}
Severity: ${healthInfo.severity}
Current Medications: ${healthInfo.medications}
Allergies: ${healthInfo.allergies}
Medical History: ${healthInfo.medicalHistory}
`;

        await squareClient.customersApi.updateCustomer(customerId, {
            note: consentRecord
        });
        console.log('✅ Saved consent forms and health info to customer record');

        // Create booking in Square
        console.log('Creating Square booking...');
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
                customerNote: `Service: ${selectedService}\nPrimary Concern: ${healthInfo.primaryConcern}`
            }
        });

        console.log('✅ Booking created successfully!');
        console.log('Booking ID:', bookingResponse.result.booking.id);

        res.json({
            success: true,
            bookingId: bookingResponse.result.booking.id,
            customerId: customerId,
            message: 'Appointment booked successfully!'
        });

    } catch (error) {
        console.error('❌ Booking Creation Error:', error);
        res.status(500).json({
            error: 'Failed to create booking',
            details: error.message,
            errors: error.errors || []
        });
    }
});

// Get all bookings (for provider portal)
app.get('/api/bookings', async (req, res) => {
    console.log('=== FETCHING ALL BOOKINGS ===');
    try {
        const response = await squareClient.bookingsApi.listBookings({
            locationId: LOCATION_ID,
            limit: 100
        });

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
                    return { ...booking, customerDetails: null };
                }
            })
        );

        res.json({ bookings: bookingsWithDetails });
    } catch (error) {
        console.error('❌ Error fetching bookings:', error);
        res.status(500).json({ 
            error: 'Failed to fetch bookings',
            details: error.message 
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

function generateFallbackSlots(startDate, endDate) {
    const slots = [];
    const current = new Date(startDate);
    
    while (current < endDate) {
        if (current.getDay() >= 1 && current.getDay() <= 5) {
            for (let hour = 9; hour < 17; hour++) {
                const slotTime = new Date(current);
                slotTime.setHours(hour, 0, 0, 0);
                
                slots.push({
                    startAt: slotTime.toISOString(),
                    appointmentSegments: [{
                        durationMinutes: 30,
                        teamMemberId: TEAM_MEMBER_ID
                    }]
                });
            }
        }
        current.setDate(current.getDate() + 1);
    }
    
    return slots;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log('Environment:', process.env.NODE_ENV || 'development');
    console.log('Location ID:', LOCATION_ID);
    console.log('Services configured:', Object.keys(SERVICE_IDS).join(', '));
});
