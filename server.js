require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client, Environment } = require('square');
const { randomUUID } = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ==================== SQUARE CLIENT ====================
const squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: process.env.SQUARE_ENVIRONMENT === 'production' 
        ? Environment.Production 
        : Environment.Sandbox
});

// ==================== CONFIG ====================
const LOCATION_ID = process.env.SQUARE_LOCATION_ID || 'LCH18SFX6M76N';
const TEAM_MEMBER_ID = process.env.TEAM_MEMBER_ID || 'TMpDyughFdZTf6ID';

// Service catalog - REAL Square Service IDs (created Oct 18, 2025)
const SERVICES = {
    'comprehensive': {
        catalogId: 'EMGH5BEA4XAVX5F35AUZAFP7',
        variationId: 'Y67G2HA7FIDECITXSSWG5IJW',
        name: 'Comprehensive Wellness Visit',
        duration: 60,
        price: 9900
    },
    'followup': {
        catalogId: '5XG2HJ3AL3R64QBZHTH56KOQ',
        variationId: 'FPUI6RZVD46ON22IPE4NKINC',
        name: 'Follow-up Consultation',
        duration: 30,
        price: 7500
    },
    'acute': {
        catalogId: '4PHOJI2QV5HAWWCKPT7G2ITI',
        variationId: 'OLIXI2RPXRE2VN6CXFQBVIB6',
        name: 'Acute Care Visit',
        duration: 20,
        price: 5000
    }
};

// ==================== SERVE FRONTEND ====================
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        square: {
            environment: process.env.SQUARE_ENVIRONMENT || 'sandbox',
            locationId: LOCATION_ID,
            teamMemberId: TEAM_MEMBER_ID,
            configured: !!process.env.SQUARE_ACCESS_TOKEN
        }
    });
});

// ==================== CHECK AVAILABILITY ====================
app.post('/api/availability', async (req, res) => {
    console.log('\n🔍 ===== AVAILABILITY CHECK REQUEST =====');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    try {
        const { serviceType, startDate, endDate } = req.body;
        
        if (!serviceType) {
            console.error('❌ Missing service type');
            return res.status(400).json({ 
                success: false, 
                error: 'Service type is required' 
            });
        }

        const service = SERVICES[serviceType];
        if (!service) {
            console.error('❌ Invalid service type:', serviceType);
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid service type: ' + serviceType 
            });
        }

        console.log(`📅 Checking availability for: ${service.name}`);
        console.log(`   Service Variation ID: ${service.variationId}`);
        console.log(`   Team Member ID: ${TEAM_MEMBER_ID}`);
        console.log(`   Location ID: ${LOCATION_ID}`);

        const start = startDate || new Date().toISOString();
        const end = endDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

        console.log(`   Date range: ${start} to ${end}`);

        const searchBody = {
            query: {
                filter: {
                    locationId: LOCATION_ID,
                    segmentFilters: [{
                        serviceVariationId: service.variationId,
                        teamMemberIdFilter: {
                            any: [TEAM_MEMBER_ID]
                        }
                    }],
                    startAtRange: {
                        startAt: start,
                        endAt: end
                    }
                }
            }
        };

        console.log('📤 Calling Square searchAvailability...');
        console.log('Request:', JSON.stringify(searchBody, null, 2));

        const response = await squareClient.bookingsApi.searchAvailability(searchBody);

        console.log('📥 Square Response Status:', response.statusCode);
        console.log('Response:', JSON.stringify(response.result, null, 2));

        if (response.result && response.result.availabilities) {
            const slots = response.result.availabilities;
            console.log(`✅ Found ${slots.length} available slots from Square`);
            
            res.json({
                success: true,
                availabilities: slots.map(avail => ({
                    startAt: avail.startAt,
                    appointmentSegments: avail.appointmentSegments,
                    locationId: avail.locationId
                })),
                source: 'square_api'
            });
        } else {
            console.log('⚠️ No availabilities returned from Square');
            res.json({
                success: true,
                availabilities: [],
                message: 'No available time slots found. Please call (248) 794-7135 to schedule.',
                source: 'square_api_empty'
            });
        }

    } catch (error) {
        console.error('\n❌ ===== AVAILABILITY CHECK ERROR =====');
        console.error('Error message:', error.message);
        console.error('Error details:', JSON.stringify(error.errors || error, null, 2));
        console.error('Stack trace:', error.stack);
        
        res.status(500).json({
            success: false,
            error: error.message,
            details: error.errors || 'Check server logs for details',
            message: 'Unable to check availability. Please call (248) 794-7135 to schedule.'
        });
    }
});

// ==================== CREATE BOOKING ====================
app.post('/api/booking', async (req, res) => {
    console.log('\n📝 ===== BOOKING REQUEST =====');
    console.log('Full request body:', JSON.stringify(req.body, null, 2));
    
    try {
        const { personal, health, consents, service, selectedSlot, paymentToken } = req.body;

        if (!personal || !service || !selectedSlot) {
            console.error('❌ Missing required fields');
            return res.status(400).json({
                success: false,
                error: 'Missing required booking information'
            });
        }

        const serviceConfig = SERVICES[service.type];
        if (!serviceConfig) {
            console.error('❌ Invalid service type:', service.type);
            return res.status(400).json({
                success: false,
                error: 'Invalid service type: ' + service.type
            });
        }

        console.log(`\n🏥 Creating booking for: ${serviceConfig.name}`);
        console.log(`👤 Patient: ${personal.firstName} ${personal.lastName}`);
        console.log(`📅 Time: ${selectedSlot.startAt}`);

        // STEP 1: Create/Find Customer
        let customerId;
        try {
            console.log('\n🔍 Searching for existing customer...');
            const searchResponse = await squareClient.customersApi.searchCustomers({
                query: {
                    filter: {
                        emailAddress: {
                            exact: personal.email
                        }
                    }
                }
            });

            if (searchResponse.result.customers && searchResponse.result.customers.length > 0) {
                customerId = searchResponse.result.customers[0].id;
                console.log('✅ Found existing customer:', customerId);
                
                await squareClient.customersApi.updateCustomer(customerId, {
                    givenName: personal.firstName,
                    familyName: personal.lastName,
                    phoneNumber: personal.phone,
                    note: buildCustomerNote(personal, health, consents, new Date().toISOString())
                });
                console.log('✅ Updated customer record');
            } else {
                console.log('➕ Creating new customer...');
                const createResponse = await squareClient.customersApi.createCustomer({
                    givenName: personal.firstName,
                    familyName: personal.lastName,
                    emailAddress: personal.email,
                    phoneNumber: personal.phone,
                    note: buildCustomerNote(personal, health, consents, new Date().toISOString())
                });
                customerId = createResponse.result.customer.id;
                console.log('✅ Created new customer:', customerId);
            }
        } catch (customerError) {
            console.error('❌ Customer Error:', customerError.message);
            throw new Error('Failed to create/update customer: ' + customerError.message);
        }

        // STEP 2: Create Payment
        let paymentId;
        if (paymentToken) {
            try {
                console.log('\n💳 Processing payment...');
                const paymentResponse = await squareClient.paymentsApi.createPayment({
                    sourceId: paymentToken,
                    amountMoney: {
                        amount: serviceConfig.price,
                        currency: 'USD'
                    },
                    customerId: customerId,
                    locationId: LOCATION_ID,
                    note: `Telehealth: ${serviceConfig.name}`,
                    idempotencyKey: randomUUID()
                });

                paymentId = paymentResponse.result.payment.id;
                console.log('✅ Payment processed:', paymentId);
            } catch (paymentError) {
                console.error('❌ Payment Error:', paymentError.message);
                throw new Error('Payment failed: ' + paymentError.message);
            }
        }

        // STEP 3: Create Booking
        try {
            console.log('\n📅 Creating Square booking...');
            
            const bookingBody = {
                booking: {
                    locationId: LOCATION_ID,
                    customerId: customerId,
                    startAt: selectedSlot.startAt,
                    appointmentSegments: [{
                        durationMinutes: serviceConfig.duration,
                        serviceVariationId: serviceConfig.variationId,
                        serviceVariationVersion: 1,
                        teamMemberId: TEAM_MEMBER_ID
                    }],
                    customerNote: buildPatientNote(health, service),
                    sellerNote: buildProviderNote(personal, health, consents, service, new Date().toISOString())
                },
                idempotencyKey: randomUUID()
            };

            console.log('📤 Booking request:', JSON.stringify(bookingBody, null, 2));

            const bookingResponse = await squareClient.bookingsApi.createBooking(bookingBody);
            
            const bookingId = bookingResponse.result.booking.id;
            console.log('✅ Booking created successfully:', bookingId);

            console.log('\n🎉 ===== BOOKING COMPLETE =====');
            res.json({
                success: true,
                bookingId: bookingId,
                customerId: customerId,
                paymentId: paymentId,
                appointmentTime: selectedSlot.startAt,
                service: serviceConfig.name,
                price: serviceConfig.price,
                doxyLink: `https://doxy.me/PatrickPJAwellness`,
                message: 'Appointment booked successfully!'
            });

        } catch (bookingError) {
            console.error('\n❌ BOOKING CREATION ERROR');
            console.error('Error message:', bookingError.message);
            console.error('Error details:', JSON.stringify(bookingError.errors, null, 2));
            
            return res.status(500).json({
                success: false,
                error: 'Failed to create booking in Square',
                message: bookingError.message,
                details: bookingError.errors
            });
        }

    } catch (error) {
        console.error('\n❌ ===== BOOKING FAILED =====');
        console.error('Error:', error.message);
        
        res.status(500).json({
            success: false,
            error: error.message || 'Booking failed'
        });
    }
});

// ==================== PROVIDER PORTAL ====================
app.get('/api/provider/appointments', async (req, res) => {
    console.log('\n🩺 ===== PROVIDER PORTAL REQUEST =====');
    
    try {
        const startAt = new Date().toISOString();
        const endAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        const response = await squareClient.bookingsApi.listBookings(
            undefined,
            undefined,
            undefined,
            TEAM_MEMBER_ID,
            LOCATION_ID,
            startAt,
            endAt
        );

        console.log('✅ Retrieved bookings:', response.result?.bookings?.length || 0);

        res.json({
            success: true,
            bookings: response.result.bookings || []
        });

    } catch (error) {
        console.error('❌ Provider Portal Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== HELPER FUNCTIONS ====================

function buildCustomerNote(personal, health, consents, timestamp) {
    return `
🏥 TELEHEALTH PATIENT RECORD
Booking Date: ${timestamp}

📋 EMERGENCY CONTACT:
${personal.emergencyName || 'None'}
${personal.emergencyPhone || ''}

🩺 CHIEF COMPLAINT: ${health.chiefComplaint}
⏱ SYMPTOM DURATION: ${health.symptomDuration || 'Not specified'}
🩹 SYMPTOMS: ${health.symptoms && health.symptoms.length > 0 ? health.symptoms.join(', ') : 'None'}
💊 MEDICATIONS: ${health.medications || 'None'}
⚠️ ALLERGIES: ${health.allergies || 'None'}

✅ CONSENT FORMS SIGNED (${timestamp}):
- HIPAA Privacy: SIGNED ✓
- Telehealth Consent: SIGNED ✓
- Recording: ${consents.recording ? 'AUTHORIZED ✓' : 'NOT AUTHORIZED'}

🔒 Platform: Doxy.me (HIPAA compliant)
Provider: Patrick Smith, BCHHP
    `.trim();
}

function buildPatientNote(health, service) {
    return `Chief Complaint: ${health.chiefComplaint}\nDuration: ${health.symptomDuration || 'Not specified'}\nSymptoms: ${health.symptoms && health.symptoms.length > 0 ? health.symptoms.join(', ') : 'None'}\n\nService: ${service.name}\nDuration: ${service.duration} minutes`;
}

function buildProviderNote(personal, health, consents, service, timestamp) {
    return `
🩺 TELEHEALTH - ${service.name}

📋 PATIENT: ${personal.firstName} ${personal.lastName}
📧 Email: ${personal.email}
📞 Phone: ${personal.phone}
🎂 DOB: ${personal.dob || 'Not provided'}
🚨 Emergency: ${personal.emergencyName || 'None'} ${personal.emergencyPhone || ''}

🏥 CHIEF COMPLAINT: ${health.chiefComplaint}
⏱ DURATION: ${health.symptomDuration || 'Not specified'}
🩹 SYMPTOMS: ${health.symptoms && health.symptoms.length > 0 ? health.symptoms.join(', ') : 'None'}
💊 MEDICATIONS: ${health.medications || 'None'}
⚠️ ALLERGIES: ${health.allergies || 'None'}

✅ CONSENTS (Signed ${timestamp}):
- HIPAA: SIGNED ✓
- Telehealth: SIGNED ✓
- Recording: ${consents.recording ? 'YES' : 'NO'}

🎥 VIDEO: https://doxy.me/PatrickPJAwellness
    `.trim();
}

// ==================== START SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n========================================');
    console.log('🏥 PJA TELEHEALTH BACKEND');
    console.log('========================================');
    console.log(`📍 Port: ${PORT}`);
    console.log(`🌍 Environment: ${process.env.SQUARE_ENVIRONMENT || 'sandbox'}`);
    console.log(`🏥 Location: ${LOCATION_ID}`);
    console.log(`✅ Ready`);
    console.log('========================================\n');
});
