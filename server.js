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

// ============================================================================
// PROVIDER CONFIGURATION - Patrick (Telehealth) + Sarah (Nutrition)
// ============================================================================
const PROVIDERS = {
    PATRICK: {
        id: 'TMpDyughFdZTf6ID',
        name: 'Patrick Smith',
        specialty: 'telehealth',
        videoRoom: 'https://doxy.me/PatrickPJAwellness',
        providerPortal: 'https://doxy.me/PatrickPJAwellness/provider'
    },
    SARAH: {
        id: 'TMvlLj1NfknViJPR',
        name: 'Sarah Cunningham',
        specialty: 'nutrition',
        videoRoom: 'https://doxy.me/PatrickPJAwellness', // Same video room
        providerPortal: 'https://doxy.me/PatrickPJAwellness/provider' // Same portal
    }
};

// Provider Passwords
const PATRICK_PASSWORD = process.env.PROVIDER_PASSWORD || 'JalenAnna2023!';
const SARAH_PASSWORD = process.env.SARAH_PASSWORD || 'Sarah2024!'; // Change this!
const SQUARE_APPLICATION_ID = process.env.SQUARE_APPLICATION_ID || 'sq0idp-aPFZ8KXI6fGJJWdCZKhDfg';

// ============================================================================
// HELPER FUNCTION: Determine which provider for a service
// ============================================================================
function getProviderForService(serviceName) {
    const lowerName = serviceName.toLowerCase();
    
    // Nutrition keywords route to Sarah
    if (lowerName.includes('nutrition')) {
        return PROVIDERS.SARAH;
    }
    
    // Telehealth keywords route to Patrick (default)
    return PROVIDERS.PATRICK;
}

// Helper functions (unchanged from original)
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

function buildProviderNote(personal, health, consents, accessCode, provider) {
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
Patient Link: ${provider.videoRoom}
Provider Portal: ${provider.providerPortal}

PROVIDER: ${provider.name}`;
}

// HEALTH CHECK
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

// SQUARE CONFIG ENDPOINT
app.get('/api/square-config', (req, res) => {
    res.json({
        applicationId: SQUARE_APPLICATION_ID,
        locationId: LOCATION_ID
    });
});

// ============================================================================
// SERVICES ENDPOINT - Updated to fetch BOTH telehealth AND nutrition
// ============================================================================
app.get('/api/services', async (req, res) => {
    try {
        console.log('📋 Fetching services (telehealth + nutrition)...');
        
        // Search for services with BOTH keywords
        const response = await squareClient.catalogApi.searchCatalogObjects({
            objectTypes: ['ITEM'],
            query: {
                textQuery: {
                    keywords: ['telehealth', 'nutrition']
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
                
                // Determine provider for this service
                const provider = getProviderForService(item.itemData.name);
                
                return {
                    id: String(item.id),
                    name: String(item.itemData.name),
                    description: String(item.itemData.description || ''),
                    price: (priceInCents / 100).toFixed(2),
                    duration: Math.floor(durationMs / 60000),
                    variationId: String(variation?.id || ''),
                    variationVersion: String(variation?.version || '1'),
                    provider: {
                        id: provider.id,
                        name: provider.name,
                        specialty: provider.specialty
                    }
                };
            });

        console.log(`✅ Found ${services.length} services (telehealth + nutrition)`);
        res.json({ services });
    } catch (error) {
        console.error('❌ Services error:', error);
        res.status(500).json({ 
            error: 'Failed to fetch services',
            details: error.message 
        });
    }
});

// ============================================================================
// AVAILABILITY ENDPOINT - Updated to use correct provider ID
// ============================================================================
app.post('/api/availability', async (req, res) => {
    try {
        const { serviceVariationId, date, providerId } = req.body;
        
        console.log('📅 Checking availability for:', { serviceVariationId, date, providerId });
        
        const startDate = new Date(date);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(date);
        endDate.setHours(23, 59, 59, 999);

        // Use the providerId from the request (determined by service type)
        const teamMemberId = providerId || PROVIDERS.PATRICK.id;

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
                            any: [teamMemberId]
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
        
        console.log(`✅ Returning ${availabilities.length} slots for ${teamMemberId}`);
        res.json({ availabilities });
    } catch (error) {
        console.error('❌ Availability check error:', error);
        res.status(500).json({ 
            error: 'Failed to check availability',
            details: error.message 
        });
    }
});

// BOOKING ENDPOINT (FREE BOOKINGS) - unchanged
app.post('/api/bookings', async (req, res) => {
    try {
        const { personal, health, consents, service, selectedTime } = req.body;
        
        console.log('📝 Creating booking for:', personal.email);
        
        // Determine provider based on service
        const provider = getProviderForService(service.name);
        console.log(`🔀 Routing to provider: ${provider.name} (${provider.specialty})`);
        
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
                    teamMemberId: provider.id, // Use correct provider ID
                    serviceVariationVersion: BigInt(Date.now())
                }],
                customerNote: buildPatientNote(health, accessCode),
                sellerNote: buildProviderNote(personal, health, consents, accessCode, provider)
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
                provider: provider.name,
                date: new Date(selectedTime.startAt).toLocaleDateString(),
                time: selectedTime.time,
                duration: `${service.duration} minutes`,
                price: `$${service.price}`,
                videoLink: provider.videoRoom,
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

// ============================================================================
// PAYMENT PROCESSING ENDPOINT - Updated with provider routing
// ============================================================================
app.post('/api/process-payment', async (req, res) => {
    try {
        const { sourceId, personal, health, consents, service, selectedTime } = req.body;
        
        console.log('💳 Processing payment for:', personal.email);
        
        // Determine provider based on service
        const provider = getProviderForService(service.name);
        console.log(`🔀 Routing to provider: ${provider.name} (${provider.specialty})`);
        
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
            note: `${service.name} - ${personal.firstName} ${personal.lastName} with ${provider.name}`
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
                    teamMemberId: provider.id, // Use correct provider ID
                    serviceVariationVersion: BigInt(Date.now())
                }],
                customerNote: buildPatientNote(health, accessCode),
                sellerNote: buildProviderNote(personal, health, consents, accessCode, provider)
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
                provider: provider.name,
                date: new Date(selectedTime.startAt).toLocaleDateString(),
                time: selectedTime.time,
                duration: `${service.duration} minutes`,
                price: `$${service.price}`,
                videoLink: provider.videoRoom,
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

// PATIENT LOGIN ENDPOINT - unchanged
app.post('/api/patient-login', async (req, res) => {
    try {
        const { accessCode, email } = req.body;
        
        console.log('🔐 Patient login attempt with access code:', accessCode);
        
        // Search for bookings with this access code in the next 90 days
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30); // Also check past 30 days
        
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 90);
        
        // Check bookings for BOTH providers
        const patrickBookings = await squareClient.bookingsApi.listBookings({
            teamMemberId: PROVIDERS.PATRICK.id,
            locationId: LOCATION_ID,
            startAtMin: startDate.toISOString(),
            startAtMax: endDate.toISOString()
        });
        
        const sarahBookings = await squareClient.bookingsApi.listBookings({
            teamMemberId: PROVIDERS.SARAH.id,
            locationId: LOCATION_ID,
            startAtMin: startDate.toISOString(),
            startAtMax: endDate.toISOString()
        });
        
        const allBookings = [
            ...(patrickBookings.result.bookings || []),
            ...(sarahBookings.result.bookings || [])
        ];
        
        console.log(`📋 Searching ${allBookings.length} bookings for access code ${accessCode} and email ${email}`);
        
        // Find booking with matching access code and email
        const matchingBooking = allBookings.find(booking => {
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

// ============================================================================
// PROVIDER LOGIN - Updated to support multiple providers
// ============================================================================
app.post('/api/provider-login', (req, res) => {
    const { password } = req.body;
    
    // Patrick's password - Owner access (sees ALL bookings)
    if (password === PATRICK_PASSWORD) {
        res.json({ 
            success: true,
            provider: {
                name: 'Patrick Smith',
                role: 'owner',
                viewAll: true,
                teamMemberId: PROVIDERS.PATRICK.id
            }
        });
    } 
    // Sarah's password - Staff access (sees ONLY her bookings)
    else if (password === SARAH_PASSWORD) {
        res.json({ 
            success: true,
            provider: {
                name: 'Sarah Cunningham',
                role: 'staff',
                viewAll: false,
                teamMemberId: PROVIDERS.SARAH.id
            }
        });
    } 
    else {
        res.status(401).json({ 
            success: false, 
            error: 'Invalid password' 
        });
    }
});

// ============================================================================
// PROVIDER BOOKINGS - Updated to fetch bookings for BOTH providers
// ============================================================================
app.get('/api/provider/bookings', async (req, res) => {
    try {
        const { teamMemberId } = req.query; // Optional filter
        
        console.log('📋 Fetching provider bookings...');
        if (teamMemberId) {
            console.log(`🔍 Filtering for team member: ${teamMemberId}`);
        }
        
        const now = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);
        
        let allBookings = [];
        
        // If filtering for specific provider, fetch only their bookings
        if (teamMemberId) {
            const response = await squareClient.bookingsApi.listBookings(
                undefined,
                undefined,
                undefined,
                teamMemberId,
                LOCATION_ID,
                now.toISOString(),
                endDate.toISOString()
            );
            allBookings = response.result.bookings || [];
        } else {
            // Fetch bookings for both providers (owner view)
            const patrickResponse = await squareClient.bookingsApi.listBookings(
                undefined,
                undefined,
                undefined,
                PROVIDERS.PATRICK.id,
                LOCATION_ID,
                now.toISOString(),
                endDate.toISOString()
            );
            
            const sarahResponse = await squareClient.bookingsApi.listBookings(
                undefined,
                undefined,
                undefined,
                PROVIDERS.SARAH.id,
                LOCATION_ID,
                now.toISOString(),
                endDate.toISOString()
            );
            
            // Combine bookings from both providers
            allBookings = [
                ...(patrickResponse.result.bookings || []),
                ...(sarahResponse.result.bookings || [])
            ];
        }
        
        const bookings = allBookings
            .map(booking => {
                // Determine provider from team member ID
                const isPatrick = booking.appointmentSegments?.[0]?.teamMemberId === PROVIDERS.PATRICK.id;
                const provider = isPatrick ? PROVIDERS.PATRICK.name : PROVIDERS.SARAH.name;
                
                return {
                    id: String(booking.id),
                    startAt: String(booking.startAt),
                    provider: provider,
                    teamMemberId: booking.appointmentSegments?.[0]?.teamMemberId,
                    customer: {
                        name: `${booking.customerNote?.split('\n')[0]?.replace('Chief Complaint: ', '') || 'Unknown'}`,
                        email: booking.sellerNote?.match(/EMAIL: (.+)/)?.[1] || '',
                        phone: booking.sellerNote?.match(/PHONE: (.+)/)?.[1] || ''
                    },
                    customerNote: booking.customerNote,
                    sellerNote: booking.sellerNote
                };
            })
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
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 Port: ${PORT}
🏥 Location: ${LOCATION_ID}

👨‍⚕️ PROVIDERS:
  • Patrick Smith (${PROVIDERS.PATRICK.id})
    - Specialty: Telehealth/Holistic Health
  • Sarah Cunningham (${PROVIDERS.SARAH.id})
    - Specialty: Nutrition Consulting

🔒 Environment: ${process.env.SQUARE_ENVIRONMENT || 'production'}
💳 Square App ID: ${SQUARE_APPLICATION_ID}
🎥 Patient Video Link: https://doxy.me/PatrickPJAwellness
👨‍⚕️ Provider Portal: https://doxy.me/PatrickPJAwellness/provider
📧 Notifications: Square SMS/Email (Automatic)
💳 Payment: Processed BEFORE booking creation
🔐 Patient Portal: 6-digit access code system enabled
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
});
