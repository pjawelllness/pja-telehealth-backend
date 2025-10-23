const express = require('express');
const cors = require('cors');
const path = require('path');
const { Client, Environment } = require('square');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Add BigInt serialization support GLOBALLY
BigInt.prototype.toJSON = function() { return this.toString(); };

// Square Client Setup
const squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: process.env.SQUARE_ENVIRONMENT === 'production' 
        ? Environment.Production 
        : Environment.Sandbox
});

// Configuration
const LOCATION_ID = 'LT1S9BE1EX0PW';
const TEAM_MEMBER_ID = 'TMpDyughFdZTf6ID';
const PROVIDER_PASSWORD = process.env.PROVIDER_PASSWORD || 'JalenAnna2023!';

// Helper function to build comprehensive customer note
function buildCustomerNote(personal, health, consents) {
    return `
PATIENT INTAKE FORM
===================

PERSONAL INFORMATION:
- Name: ${personal.firstName} ${personal.lastName}
- Email: ${personal.email}
- Phone: ${personal.phone}
- Date of Birth: ${personal.dob}
- Emergency Contact: ${personal.emergencyName || 'Not provided'} (${personal.emergencyPhone || 'Not provided'})

CHIEF COMPLAINT:
${health.chiefComplaint}

SYMPTOM DURATION:
${health.symptomDuration}

CURRENT SYMPTOMS:
${health.symptoms.length > 0 ? health.symptoms.join(', ') : 'None reported'}

MEDICATIONS:
${health.medications || 'None reported'}

ALLERGIES:
${health.allergies || 'None reported'}

CONSENTS:
- HIPAA Privacy Notice: ${consents.hipaa ? 'Acknowledged' : 'Not acknowledged'}
- Telehealth Informed Consent: ${consents.telehealth ? 'Agreed' : 'Not agreed'}
- Session Recording: ${consents.recording ? 'Consented' : 'Declined'}

📹 VIDEO CONSULTATION:
Patient joins at: https://doxy.me/PatrickPJAwellness
Provider joins at: https://doxy.me/PatrickPJAwellness/provider

INSTRUCTIONS FOR PATIENT:
1. At appointment time, click the patient link above
2. You'll enter a virtual waiting room
3. Patrick will admit you to the video call
4. Ensure camera and microphone are working
5. Find a quiet, private space for the consultation

FORM COMPLETED: ${new Date().toISOString()}
`.trim();
}

function buildPatientNote(health) {
    return `Chief Complaint: ${health.chiefComplaint}

Duration: ${health.symptomDuration}
Symptoms: ${health.symptoms.length > 0 ? health.symptoms.join(', ') : 'None reported'}

📹 VIDEO LINK: https://doxy.me/PatrickPJAwellness
At your appointment time, click the link above to join your video consultation.`;
}

function buildProviderNote(personal, health, consents) {
    return `PATIENT: ${personal.firstName} ${personal.lastName}
DOB: ${personal.dob}
EMAIL: ${personal.email}
PHONE: ${personal.phone}

CHIEF COMPLAINT: ${health.chiefComplaint}
DURATION: ${health.symptomDuration}
SYMPTOMS: ${health.symptoms.join(', ')}

MEDICATIONS: ${health.medications || 'None'}
ALLERGIES: ${health.allergies || 'None'}

EMERGENCY CONTACT: ${personal.emergencyName || 'N/A'} (${personal.emergencyPhone || 'N/A'})

CONSENTS:
- HIPAA: ${consents.hipaa ? 'Yes' : 'No'}
- Telehealth: ${consents.telehealth ? 'Yes' : 'No'}
- Recording: ${consents.recording ? 'Yes' : 'No'}

📹 DOXY.ME LINKS:
Patient Link: https://doxy.me/PatrickPJAwellness
Provider Portal: https://doxy.me/PatrickPJAwellness/provider`;
}

// HEALTH CHECK
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

// SERVICES ENDPOINT
app.get('/api/services', async (req, res) => {
    try {
        console.log('📋 Fetching telehealth services...');
        
        const response = await squareClient.catalogApi.searchCatalogObjects({
            objectTypes: ['ITEM'],
            query: {
                textQuery: {
                    keywords: ['telehealth']
                }
            }
        });

        const services = (response.result.objects || [])
            .filter(item => item.type === 'ITEM' && item.itemData?.productType === 'APPOINTMENTS_SERVICE')
            .map(item => {
                const variation = item.itemData.variations?.[0];
                const priceAmount = variation?.itemVariationData?.priceMoney?.amount;
                const serviceDuration = variation?.itemVariationData?.serviceDuration;
                
                const priceInCents = Number(priceAmount || 0);
                const durationMs = Number(serviceDuration || 0);
                
                return {
                    id: String(item.id),
                    name: String(item.itemData.name),
                    description: String(item.itemData.description || ''),
                    price: (priceInCents / 100).toFixed(2),
                    duration: Math.floor(durationMs / 60000),
                    variationId: String(variation?.id || ''),
                    variationVersion: String(variation?.version || '1')
                };
            });

        console.log(`✅ Found ${services.length} telehealth services`);
        res.json({ services });
    } catch (error) {
        console.error('❌ Services error:', error);
        res.status(500).json({ 
            error: 'Failed to fetch services',
            details: error.message 
        });
    }
});

// AVAILABILITY ENDPOINT
app.post('/api/availability', async (req, res) => {
    try {
        const { serviceVariationId, date } = req.body;
        
        console.log('📅 Checking availability for:', { serviceVariationId, date });
        
        const startDate = new Date(date);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(date);
        endDate.setHours(23, 59, 59, 999);

        const response = await squareClient.bookingsApi.searchAvailability({
            query: {
                filter: {
                    startAtRange: {
                        startAt: startDate.toISOString(),
                        endAt: endDate.toISOString()
                    },
                    locationId: LOCATION_ID,
                    segmentFilters: [{
                        serviceVariationId: serviceVariationId,
                        teamMemberIdFilter: {
                            any: [TEAM_MEMBER_ID]
                        }
                    }]
                }
            }
        });

        const availabilities = (response.result.availabilities || []).map(slot => ({
            startAt: String(slot.startAt),
            time: new Date(String(slot.startAt)).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: 'America/New_York'
            })
        }));
        
        console.log(`✅ Returning ${availabilities.length} slots`);
        res.json({ availabilities });
    } catch (error) {
        console.error('❌ Availability check error:', error);
        res.status(500).json({ 
            error: 'Failed to check availability',
            details: error.message 
        });
    }
});

// BOOKING ENDPOINT (Original)
app.post('/api/booking', async (req, res) => {
    try {
        const { personal, health, consents, service, selectedTime } = req.body;
        
        console.log('📝 Creating booking for:', personal.email);
        
        let customerId = null;
        try {
            const searchResult = await squareClient.customersApi.searchCustomers({
                query: {
                    filter: {
                        emailAddress: {
                            exact: personal.email
                        }
                    }
                }
            });
            
            if (searchResult.result.customers && searchResult.result.customers.length > 0) {
                customerId = searchResult.result.customers[0].id;
                console.log('✅ Found existing customer:', customerId);
                
                await squareClient.customersApi.updateCustomer(customerId, {
                    givenName: personal.firstName,
                    familyName: personal.lastName,
                    emailAddress: personal.email,
                    phoneNumber: personal.phone,
                    note: buildCustomerNote(personal, health, consents)
                });
                console.log('✅ Updated customer information');
            }
        } catch (searchError) {
            console.log('ℹ️ No existing customer found, will create new');
        }
        
        if (!customerId) {
            const customerResult = await squareClient.customersApi.createCustomer({
                givenName: personal.firstName,
                familyName: personal.lastName,
                emailAddress: personal.email,
                phoneNumber: personal.phone,
                note: buildCustomerNote(personal, health, consents)
            });
            customerId = customerResult.result.customer.id;
            console.log('✅ Created new customer:', customerId);
        }
        
        const bookingResult = await squareClient.bookingsApi.createBooking({
            booking: {
                locationId: LOCATION_ID,
                customerId: customerId,
                startAt: selectedTime.startAt,
                appointmentSegments: [{
                    durationMinutes: service.duration,
                    serviceVariationId: service.variationId,
                    teamMemberId: TEAM_MEMBER_ID,
                    serviceVariationVersion: BigInt(Date.now())
                }],
                customerNote: buildPatientNote(health),
                sellerNote: buildProviderNote(personal, health, consents)
            }
        });
        
        console.log('✅ Booking created:', bookingResult.result.booking.id);
        console.log('📧 Square will send confirmation email/SMS automatically');
        
        res.json({
            success: true,
            bookingId: String(bookingResult.result.booking.id),
            confirmation: {
                service: service.name,
                date: new Date(selectedTime.startAt).toLocaleDateString(),
                time: selectedTime.time,
                duration: `${service.duration} minutes`,
                price: `$${service.price}`,
                videoLink: 'https://doxy.me/PatrickPJAwellness',
                message: 'Check your email/SMS for your appointment confirmation with video link!'
            }
        });
        
    } catch (error) {
        console.error('❌ Booking error:', error);
        res.status(500).json({ 
            error: 'Failed to create booking',
            details: error.message 
        });
    }
});

// PAYMENT PROCESSING ENDPOINT (New)
app.post('/api/process-payment', async (req, res) => {
    try {
        const { sourceId, personal, health, consents, service, selectedTime } = req.body;
        
        console.log('💳 Processing payment for:', personal.email);
        
        const amountCents = Math.round(parseFloat(service.price) * 100);
        
        let customerId = null;
        try {
            const searchResult = await squareClient.customersApi.searchCustomers({
                query: {
                    filter: {
                        emailAddress: {
                            exact: personal.email
                        }
                    }
                }
            });
            
            if (searchResult.result.customers && searchResult.result.customers.length > 0) {
                customerId = searchResult.result.customers[0].id;
                console.log('✅ Found existing customer:', customerId);
                
                await squareClient.customersApi.updateCustomer(customerId, {
                    givenName: personal.firstName,
                    familyName: personal.lastName,
                    emailAddress: personal.email,
                    phoneNumber: personal.phone,
                    note: buildCustomerNote(personal, health, consents)
                });
                console.log('✅ Updated customer information');
            }
        } catch (searchError) {
            console.log('ℹ️ No existing customer found, will create new');
        }
        
        if (!customerId) {
            const customerResult = await squareClient.customersApi.createCustomer({
                givenName: personal.firstName,
                familyName: personal.lastName,
                emailAddress: personal.email,
                phoneNumber: personal.phone,
                note: buildCustomerNote(personal, health, consents)
            });
            customerId = customerResult.result.customer.id;
            console.log('✅ Created new customer:', customerId);
        }
        
        console.log('💰 Processing payment...');
        const paymentResponse = await squareClient.paymentsApi.createPayment({
            sourceId: sourceId,
            idempotencyKey: require('crypto').randomUUID(),
            amountMoney: {
                amount: BigInt(amountCents),
                currency: 'USD'
            },
            customerId: customerId,
            locationId: LOCATION_ID,
            note: `Telehealth: ${service.name} - ${personal.firstName} ${personal.lastName}`
        });
        
        console.log('✅ Payment successful:', paymentResponse.result.payment.id);
        
        console.log('📝 Creating booking after successful payment...');
        const bookingResult = await squareClient.bookingsApi.createBooking({
            booking: {
                locationId: LOCATION_ID,
                customerId: customerId,
                startAt: selectedTime.startAt,
                appointmentSegments: [{
                    durationMinutes: service.duration,
                    serviceVariationId: service.variationId,
                    teamMemberId: TEAM_MEMBER_ID,
                    serviceVariationVersion: BigInt(Date.now())
                }],
                customerNote: buildPatientNote(health),
                sellerNote: buildProviderNote(personal, health, consents)
            }
        });
        
        console.log('✅ Booking created:', bookingResult.result.booking.id);
        console.log('📧 Square will send confirmation email/SMS automatically');
        
        res.json({
            success: true,
            paymentId: String(paymentResponse.result.payment.id),
            bookingId: String(bookingResult.result.booking.id),
            confirmation: {
                service: service.name,
                date: new Date(selectedTime.startAt).toLocaleDateString(),
                time: selectedTime.time,
                duration: `${service.duration} minutes`,
                price: `$${service.price}`,
                videoLink: 'https://doxy.me/PatrickPJAwellness',
                message: 'Check your email/SMS for your appointment confirmation with video link!'
            }
        });
        
    } catch (error) {
        console.error('❌ Payment/Booking error:', error);
        res.status(500).json({ 
            error: 'Failed to process payment or create booking',
            details: error.message 
        });
    }
});

// PROVIDER LOGIN
app.post('/api/provider-login', (req, res) => {
    const { password } = req.body;
    
    if (password === PROVIDER_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ 
            success: false, 
            error: 'Invalid password' 
        });
    }
});

// PROVIDER BOOKINGS
app.get('/api/provider/bookings', async (req, res) => {
    try {
        console.log('📋 Fetching provider bookings...');
        
        const now = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);
        
        const response = await squareClient.bookingsApi.listBookings(
            undefined,
            undefined,
            undefined,
            TEAM_MEMBER_ID,
            LOCATION_ID,
            now.toISOString(),
            endDate.toISOString()
        );
        
        const bookings = (response.result.bookings || [])
            .map(booking => ({
                id: String(booking.id),
                startAt: String(booking.startAt),
                customer: {
                    name: `${booking.customerNote?.split('\n')[0]?.replace('Chief Complaint: ', '') || 'Unknown'}`,
                    email: booking.sellerNote?.match(/EMAIL: (.+)/)?.[1] || '',
                    phone: booking.sellerNote?.match(/PHONE: (.+)/)?.[1] || ''
                },
                customerNote: booking.customerNote,
                sellerNote: booking.sellerNote
            }))
            .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
        
        console.log(`✅ Found ${bookings.length} bookings`);
        res.json({ bookings });
    } catch (error) {
        console.error('❌ Error fetching bookings:', error);
        res.status(500).json({ 
            error: 'Failed to fetch bookings',
            details: error.message 
        });
    }
});

// Serve index.html for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Catch-all - MUST be last!
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
🚀 PJA Wellness Telehealth Backend Running!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 Port: ${PORT}
🏥 Location: ${LOCATION_ID}
👨‍⚕️ Provider: Patrick Smith (${TEAM_MEMBER_ID})
🔒 Environment: ${process.env.SQUARE_ENVIRONMENT || 'production'}
🎥 Patient Video Link: https://doxy.me/PatrickPJAwellness
👨‍⚕️ Provider Portal: https://doxy.me/PatrickPJAwellness/provider
📧 Notifications: Square SMS/Email (Automatic)
💳 Payment: Processed BEFORE booking creation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
});
