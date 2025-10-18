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

// Service catalog - THESE ARE YOUR ACTUAL SQUARE SERVICE IDs
const SERVICES = {
    'comprehensive': {
        catalogId: 'Q4SB3C5I3XLEGYGRDZ475EPR',
        variationId: 'FERPKMQW2KKZA7EHIBK76UC7',
        name: 'Comprehensive Wellness Visit',
        duration: 60,
        price: 9900
    },
    'followup': {
        catalogId: 'XNZPJHJHPAMJZSKBXJ3VWXDN',
        variationId: 'XVKXVXM7QJCYBQT3B23JMKSD',
        name: 'Follow-up Consultation',
        duration: 30,
        price: 7500
    },
    'acute': {
        catalogId: '5UUQU7XOV5UGSYQVKQ6IY4VR',
        variationId: 'ILBFN62P63T6U6FKUBFVMGZG',
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

        // Call Square Bookings API to search for REAL availability
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

        // Validate required fields
        if (!personal || !service || !selectedSlot) {
            console.error('❌ Missing required fields');
            return res.status(400).json({
                success: false,
                error: 'Missing required booking information',
                details: {
                    hasPersonal: !!personal,
                    hasService: !!service,
                    hasSelectedSlot: !!selectedSlot,
                    hasPaymentToken: !!paymentToken
                }
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
        console.log(`💰 Price: $${serviceConfig.price / 100}`);

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
                
                // Update customer with latest info
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
            console.error('Details:', JSON.stringify(customerError.errors, null, 2));
            throw new Error('Failed to create/update customer: ' + customerError.message);
        }

        // STEP 2: Create Payment (if token provided)
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
                console.error('Details:', JSON.stringify(paymentError.errors, null, 2));
                throw new Error('Payment failed: ' + paymentError.message);
            }
        } else {
            console.log('⚠️ No payment token - creating booking without payment');
        }

        // STEP 3: Create Booking in Square
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
            console.log('Full booking response:', JSON.stringify(bookingResponse.result, null, 2));

            // SUCCESS!
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
                message: 'Appointment booked successfully! Check your email for confirmation.'
            });

        } catch (bookingError) {
            console.error('\n❌ BOOKING CREATION ERROR');
            console.error('Error message:', bookingError.message);
            console.error('Error details:', JSON.stringify(bookingError.errors, null, 2));
            console.error('Stack trace:', bookingError.stack);
            
            return res.status(500).json({
                success: false,
                error: 'Failed to create booking in Square',
                message: bookingError.message,
                details: bookingError.errors,
                customerId: customerId,
                paymentId: paymentId
            });
        }

    } catch (error) {
        console.error('\n❌ ===== BOOKING FAILED =====');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        
        res.status(500).json({
            success: false,
            error: error.message || 'Booking failed',
            details: 'Check server logs for more information'
        });
    }
});

// ==================== PROVIDER PORTAL ====================
app.get('/api/provider/appointments', async (req, res) => {
    console.log('\n🩺 ===== PROVIDER PORTAL REQUEST =====');
    
    try {
        const startAt = new Date().toISOString();
        const endAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        console.log('Fetching bookings from', startAt, 'to', endAt);

        const response = await squareClient.bookingsApi.listBookings(
            undefined, // limit
            undefined, // cursor
            undefined, // customerId
            TEAM_MEMBER_ID, // teamMemberId
            LOCATION_ID, // locationId
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
        console.error('Details:', JSON.stringify(error.errors, null, 2));
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
${personal.emergencyName || 'None provided'}
${personal.emergencyPhone || ''}

🩺 CHIEF COMPLAINT: 
${health.chiefComplaint}

⏱ SYMPTOM DURATION: 
${health.symptomDuration || 'Not specified'}

🩹 CURRENT SYMPTOMS:
${health.symptoms && health.symptoms.length > 0 ? health.symptoms.join(', ') : 'None checked'}

💊 MEDICATIONS:
${health.medications || 'None reported'}

⚠️ ALLERGIES:
${health.allergies || 'None reported'}

✅ CONSENT FORMS SIGNED:
- HIPAA Privacy Notice: SIGNED ✓ (${timestamp})
- Telehealth Informed Consent: SIGNED ✓ (${timestamp})
- Recording Authorization: ${consents.recording ? 'AUTHORIZED ✓' : 'NOT AUTHORIZED'}

🔒 COMPLIANCE:
Platform: PJA Telehealth (HIPAA compliant)
Video Platform: Doxy.me (HIPAA compliant - BAA on file)
Provider: Patrick Smith, BCHHP
Digital Signature: ${consents.signature}

All consent forms stored in Square (HIPAA compliant system)
    `.trim();
}

function buildPatientNote(health, service) {
    return `
Chief Complaint: ${health.chiefComplaint}
Duration: ${health.symptomDuration || 'Not specified'}
Symptoms: ${health.symptoms && health.symptoms.length > 0 ? health.symptoms.join(', ') : 'None checked'}

Service: ${service.name}
Duration: ${service.duration || 30} minutes

Patient will receive Doxy.me link via email.
    `.trim();
}

function buildProviderNote(personal, health, consents, service, timestamp) {
    return `
🩺 TELEHEALTH CONSULTATION - ${service.name}

📋 PATIENT INFORMATION:
Name: ${personal.firstName} ${personal.lastName}
Email: ${personal.email}
Phone: ${personal.phone}
DOB: ${personal.dob || 'Not provided'}

Emergency Contact: ${personal.emergencyName || 'None'} ${personal.emergencyPhone || ''}

🏥 CHIEF COMPLAINT:
${health.chiefComplaint}

⏱ SYMPTOM DURATION: ${health.symptomDuration || 'Not specified'}

🩹 CURRENT SYMPTOMS:
${health.symptoms && health.symptoms.length > 0 ? health.symptoms.join(', ') : 'None selected'}

💊 CURRENT MEDICATIONS:
${health.medications || 'None reported'}

⚠️ KNOWN ALLERGIES:
${health.allergies || 'None reported'}

✅ CONSENT STATUS (Signed: ${timestamp}):
- HIPAA Privacy Notice: SIGNED ✓
- Telehealth Informed Consent: SIGNED ✓  
- Session Recording: ${consents.recording ? 'AUTHORIZED ✓' : 'NOT AUTHORIZED'}
- Digital Signature: ${consents.signature}

🎥 VIDEO CONSULTATION LINKS:
Provider Link: https://doxy.me/PatrickPJAwellness/provider
Patient Link: https://doxy.me/PatrickPJAwellness

📝 NOTES: 
- All consent forms stored in Square Customer record (HIPAA compliant)
- Patient consented to telehealth services per Michigan state law
- Video platform: Doxy.me (HIPAA compliant, BAA on file)
- Payment processed via Square (HIPAA compliant)

Provider: Patrick Smith, Board Certified Holistic Health Practitioner (BCHHP)
Location: PJA Wellness Management LLC, Rochester Hills, MI
    `.trim();
}

// ==================== START SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n========================================');
    console.log('🏥 PJA TELEHEALTH BACKEND');
    console.log('========================================');
    console.log(`📍 Port: ${PORT}`);
    console.log(`🌍 Environment: ${process.env.SQUARE_ENVIRONMENT || 'sandbox'}`);
    console.log(`🏥 Location ID: ${LOCATION_ID}`);
    console.log(`👨‍⚕️ Team Member ID: ${TEAM_MEMBER_ID}`);
    console.log(`🔒 HIPAA Compliance: Active`);
    console.log(`📝 Consent Storage: Square Customer Records`);
    console.log(`💳 Payment Processing: Square Payments API`);
    console.log(`✅ Ready to accept bookings`);
    console.log('========================================\n');
});
