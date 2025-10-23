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
const SQUARE_APPLICATION_ID = process.env.SQUARE_APPLICATION_ID || 'sq0idp-aPFZ8KXI6fGJJWdCZKhDfg';

// Helper functions
function generateAccessCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function buildCustomerNote(personal, health, consents, accessCode) {
    return `
PATIENT INTAKE FORM
===================

🔐 PATIENT ACCESS CODE: ${accessCode}
(Use this code to view your appointment details)

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

function buildPatientNote(health, accessCode) {
    return `🔐 ACCESS CODE: ${accessCode}

Chief Complaint: ${health.chiefComplaint}

Duration: ${health.symptomDuration}
Symptoms: ${health.symptoms.length > 0 ? health.symptoms.join(', ') : 'None reported'}

📹 VIDEO LINK: https://doxy.me/PatrickPJAwellness
At your appointment time, click the link above to join your video consultation.

To view your appointment details anytime, visit our website and use your 6-digit access code: ${accessCode}`;
}

function buildProviderNote(personal, health, consents, accessCode) {
    return `🔐 PATIENT ACCESS CODE: ${accessCode}

PATIENT: ${personal.firstName} ${personal.lastName}
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

// NEW: SQUARE CONFIG ENDPOINT - Provides Square credentials to frontend
app.get('/api/square-config', (req, res) => {
    res.json({
        applicationId: SQUARE_APPLICATION_ID,
        locationId: LOCATION_ID
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

// BOOKING ENDPOINT (FREE BOOKINGS)
app.post('/api/bookings', async (req, res) => {
    try {
        const { personal, health, consents, service, selectedTime } = req.body;
        
        console.log('📝 Creating booking for:', personal.email);
        
        // Generate unique 6-digit access code
        const accessCode = generateAccessCode();
        console.log('🔐 Generated access code:', accessCode);
        
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
                    note: buildCustomerNote(personal, health, consents, accessCode)
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
                note: buildCustomerNote(personal, health, consents, accessCode)
            });
            customerId = customerResult.result.customer.id;
            console.log('✅ Created new customer:', customerId);
        }
        
        console.log('📅 Creating booking...');
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
                customerNote: buildPatientNote(health, accessCode),
                sellerNote: buildProviderNote(personal, health, consents, accessCode)
            }
        });
        
        console.log('✅ Booking created:', bookingResult.result.booking.id);
        console.log('📧 Square will send confirmation email/SMS automatically');
        
        res.json({
            success: true,
            bookingId: String(bookingResult.result.booking.id),
            accessCode: accessCode,
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
        
        // Generate unique 6-digit access code
        const accessCode = generateAccessCode();
        console.log('🔐 Generated access code:', accessCode);
        
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
                    note: buildCustomerNote(personal, health, consents, accessCode)
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
                note: buildCustomerNote(personal, health, consents, accessCode)
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
                customerNote: buildPatientNote(health, accessCode),
                sellerNote: buildProviderNote(personal, health, consents, accessCode)
            }
        });
        
        console.log('✅ Booking created:', bookingResult.result.booking.id);
        console.log('📧 Square will send confirmation email/SMS automatically');
        
        res.json({
            success: true,
            paymentId: String(paymentResponse.result.payment.id),
            bookingId: String(bookingResult.result.booking.id),
            accessCode: accessCode,
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

// PATIENT LOGIN ENDPOINT (New)
app.post('/api/patient-login', async (req, res) => {
    try {
        const { accessCode, email } = req.body;
        
        console.log('🔐 Patient login attempt with access code:', accessCode);
        
        // Search for bookings with this access code in the next 90 days
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30); // Also check past 30 days
        
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 90);
        
        const response = await squareClient.bookingsApi.listBookings({
            teamMemberId: TEAM_MEMBER_ID,
            locationId: LOCATION_ID,
            startAtMin: startDate.toISOString(),
            startAtMax: endDate.toISOString()
        });
        
        const bookings = response.result.bookings || [];
        
        console.log(`📋 Searching ${bookings.length} bookings for access code ${accessCode} and email ${email}`);
        
        // Find booking with matching access code and email
        const matchingBooking = bookings.find(booking => {
            const hasAccessCode = booking.customerNote?.includes(`ACCESS CODE: ${accessCode}`) ||
                                 booking.sellerNote?.includes(`ACCESS CODE: ${accessCode}`);
            
            if (!hasAccessCode) return false;
            
            // Verify email matches
            const sellerNote = booking.sellerNote || '';
            return sellerNote.includes(`EMAIL: ${email}`);
        });
        
        if (!matchingBooking) {
            console.log('❌ No matching appointment found');
            return res.status(404).json({
                success: false,
                error: 'No appointment found with the provided access code and email'
            });
        }
        
        // Get customer details
        const customer = await squareClient.customersApi.retrieveCustomer(matchingBooking.customerId);
        
        console.log('✅ Patient login successful');
        res.json({
            success: true,
            appointment: {
                id: String(matchingBooking.id),
                startAt: String(matchingBooking.startAt),
                date: new Date(matchingBooking.startAt).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                }),
                time: new Date(matchingBooking.startAt).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                    timeZone: 'America/New_York'
                }),
                duration: matchingBooking.appointmentSegments[0]?.durationMinutes || 0,
                patient: {
                    name: `${customer.result.customer.givenName || ''} ${customer.result.customer.familyName || ''}`.trim(),
                    email: customer.result.customer.emailAddress || '',
                    phone: customer.result.customer.phoneNumber || ''
                },
                videoLink: 'https://doxy.me/PatrickPJAwellness',
                customerNote: matchingBooking.customerNote,
                status: matchingBooking.status
            }
        });
        
    } catch (error) {
        console.error('❌ Patient login error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to verify appointment',
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
💳 Square App ID: ${SQUARE_APPLICATION_ID}
🎥 Patient Video Link: https://doxy.me/PatrickPJAwellness
👨‍⚕️ Provider Portal: https://doxy.me/PatrickPJAwellness/provider
📧 Notifications: Square SMS/Email (Automatic)
💳 Payment: Processed BEFORE booking creation
🔐 Patient Portal: 6-digit access code system enabled
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
});
