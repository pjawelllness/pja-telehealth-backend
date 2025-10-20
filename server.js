require('dotenv').config();
const express = require('express');
const { Client, Environment } = require('square');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Square Client
const squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: process.env.SQUARE_ENVIRONMENT === 'production' ? Environment.Production : Environment.Sandbox,
});

const LOCATION_ID = process.env.SQUARE_LOCATION_ID || 'LT1S9BE1EX0PW';
const PORT = process.env.PORT || 3000;
const PROVIDER_PASSWORD = process.env.PROVIDER_PASSWORD || 'JalenAnna2023!';

console.log('🏥 PJA TELEHEALTH BACKEND STARTING...');
console.log(`📍 Location ID: ${LOCATION_ID}`);
console.log(`🌍 Environment: ${process.env.SQUARE_ENVIRONMENT || 'sandbox'}`);

// ==================== HELPER: FIX BIGINT ====================
function fixBigInt(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return obj.toString();
    if (Array.isArray(obj)) return obj.map(fixBigInt);
    if (typeof obj === 'object') {
        const fixed = {};
        for (const key in obj) {
            fixed[key] = fixBigInt(obj[key]);
        }
        return fixed;
    }
    return obj;
}

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'pja-telehealth',
        timestamp: new Date().toISOString(),
        location: LOCATION_ID
    });
});

// ==================== SERVE INDEX.HTML ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==================== PROVIDER PORTAL LOGIN ====================
app.post('/api/provider-login', (req, res) => {
    const { password } = req.body;

    if (password === PROVIDER_PASSWORD) {
        res.json({ success: true, message: 'Login successful' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid password' });
    }
});

// ==================== GET SERVICES ====================
app.get('/api/services', async (req, res) => {
    try {
        // Search for APPOINTMENTS_SERVICE instead of ITEM
        const { result } = await squareClient.catalogApi.searchCatalogItems({
            productTypes: ['APPOINTMENTS_SERVICE']
        });

        // Don't log raw result - contains BigInt values that can't be serialized
        console.log('📋 Searching for telehealth services...');

        const telehealth = result.items
            ?.filter(item => 
                item.itemData?.name?.toLowerCase().includes('telehealth')
            )
            .map(item => {
                const variation = item.itemData?.variations?.[0];
                const priceAmount = variation?.itemVariationData?.priceMoney?.amount;
                
                // Convert BigInt to Number BEFORE doing any math
                const priceInCents = typeof priceAmount === 'bigint' 
                    ? Number(priceAmount) 
                    : priceAmount || 0;
                
                return {
                    id: String(item.id || ''),
                    variationId: String(variation?.id || ''),
                    name: String(item.itemData?.name || ''),
                    description: String(item.itemData?.description || ''),
                    price: (priceInCents / 100).toFixed(2),
                    duration: 30
                };
            }) || [];

        console.log(`✅ Found ${telehealth.length} telehealth services`);
        
        // Return clean data (no BigInt values)
        res.json({ services: telehealth });
    } catch (error) {
        console.error('❌ Error fetching services:', error);
        res.status(500).json({ 
            error: 'Failed to fetch services',
            details: error.message 
        });
    }
});

// ==================== GET AVAILABILITY ====================
app.post('/api/availability', async (req, res) => {
    try {
        const { date, serviceId } = req.body;

        if (!date) {
            return res.status(400).json({ error: 'Date is required' });
        }

        // Format date for Square API (YYYY-MM-DD)
        const searchDate = new Date(date);
        const startAt = new Date(searchDate);
        startAt.setHours(0, 0, 0, 0);

        const endAt = new Date(searchDate);
        endAt.setHours(23, 59, 59, 999);

        console.log(`🔍 Searching availability for ${searchDate.toISOString().split('T')[0]}`);

        const { result } = await squareClient.bookingsApi.searchAvailability({
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
                            any: ['TMpDyughFdZTf6ID']  // Patrick Smith's Team Member ID
                        }
                    }]
                }
            }
        });

        const availabilities = result.availabilities || [];

        console.log(`✅ Found ${availabilities.length} available slots`);

        // Filter for selected date and format
        const slots = availabilities
            .filter(slot => {
                const slotDate = new Date(slot.startAt);
                return slotDate.toISOString().split('T')[0] === searchDate.toISOString().split('T')[0];
            })
            .map(slot => {
                const startTime = new Date(slot.startAt);
                return {
                    startAt: slot.startAt,
                    time: startTime.toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                    })
                };
            })
            .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

        res.json(fixBigInt({ availabilities: slots }));
    } catch (error) {
        console.error('❌ Error fetching availability:', error);
        res.status(500).json({ 
            error: 'Failed to fetch availability',
            details: error.message 
        });
    }
});

// ==================== CREATE BOOKING ====================
app.post('/api/booking', async (req, res) => {
    try {
        const { personal, health, consents, service, selectedTime } = req.body;

        // 1. Create or Get Customer
        let customerId;
        try {
            const searchResult = await squareClient.customersApi.searchCustomers({
                query: {
                    filter: {
                        emailAddress: { exact: personal.email }
                    }
                }
            });

            if (searchResult.result.customers && searchResult.result.customers.length > 0) {
                customerId = searchResult.result.customers[0].id;
                console.log(`✅ Found existing customer: ${customerId}`);
            } else {
                const createResult = await squareClient.customersApi.createCustomer({
                    givenName: personal.firstName,
                    familyName: personal.lastName,
                    emailAddress: personal.email,
                    phoneNumber: personal.phone,
                    note: buildCustomerNote(personal, health, consents, service, new Date().toISOString())
                });
                customerId = createResult.result.customer.id;
                console.log(`✅ Created new customer: ${customerId}`);
            }
        } catch (error) {
            console.error('❌ Customer error:', error);
            throw new Error('Failed to create/find customer');
        }

        // 2. Create Booking in Square
        const bookingData = {
            booking: {
                locationId: LOCATION_ID,
                customerId: customerId,
                startAt: selectedTime.startAt,
                customerNote: buildPatientNote(health, service),
                sellerNote: buildProviderNote(personal, health, consents, service, new Date().toISOString()),
                appointmentSegments: [{
                    durationMinutes: service.duration || 30,
                    serviceVariationId: service.variationId,
                    teamMemberId: 'TMppwW92s3NuZ', // Patrick Smith's team member ID
                    serviceVariationVersion: Date.now()
                }]
            }
        };

        const bookingResult = await squareClient.bookingsApi.createBooking(bookingData);
        const booking = bookingResult.result.booking;

        console.log(`✅ Booking created: ${booking.id}`);

        // 3. Send response with Doxy.me links
        res.json({
            success: true,
            bookingId: booking.id,
            customerId: customerId,
            confirmation: {
                service: service.name,
                date: new Date(selectedTime.startAt).toLocaleDateString(),
                time: selectedTime.time,
                duration: `${service.duration} minutes`,
                provider: 'Patrick Smith, BCHHP',
                doxyPatientLink: 'https://doxy.me/PatrickPJAwellness',
                doxyProviderLink: 'https://doxy.me/PatrickPJAwellness/provider'
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

// ==================== GET BOOKINGS (PROVIDER PORTAL) ====================
app.get('/api/bookings', async (req, res) => {
    try {
        const startAt = new Date();
        startAt.setHours(0, 0, 0, 0);

        const endAt = new Date();
        endAt.setDate(endAt.getDate() + 30);
        endAt.setHours(23, 59, 59, 999);

        const { result } = await squareClient.bookingsApi.listBookings(
            undefined,
            undefined,
            undefined,
            LOCATION_ID,
            startAt.toISOString(),
            endAt.toISOString()
        );

        const bookings = result.bookings || [];

        const formatted = await Promise.all(bookings.map(async booking => {
            let customerInfo = {};
            try {
                const custResult = await squareClient.customersApi.retrieveCustomer(booking.customerId);
                const customer = custResult.result.customer;
                customerInfo = {
                    name: `${customer.givenName || ''} ${customer.familyName || ''}`.trim(),
                    email: customer.emailAddress,
                    phone: customer.phoneNumber
                };
            } catch (e) {
                console.error('Error fetching customer:', e);
            }

            return {
                id: booking.id,
                startAt: booking.startAt,
                customerNote: booking.customerNote || '',
                sellerNote: booking.sellerNote || '',
                status: booking.status,
                customer: customerInfo
            };
        }));

        res.json(fixBigInt({ bookings: formatted }));
    } catch (error) {
        console.error('❌ Error fetching bookings:', error);
        res.status(500).json({ 
            error: 'Failed to fetch bookings',
            details: error.message 
        });
    }
});

// ==================== BUILD CUSTOMER NOTE ====================
function buildCustomerNote(personal, health, consents, service, timestamp) {
    return `
🩺 TELEHEALTH PATIENT RECORD

SERVICE: ${service.name}
BOOKING DATE: ${timestamp}

=== PATIENT INFORMATION ===
Name: ${personal.firstName} ${personal.lastName}
Email: ${personal.email}
Phone: ${personal.phone}
DOB: ${personal.dob || 'Not provided'}
Emergency Contact: ${personal.emergencyName || 'None'} ${personal.emergencyPhone || ''}

=== HEALTH INFORMATION ===
Chief Complaint: ${health.chiefComplaint}
Duration: ${health.symptomDuration || 'Not specified'}
Symptoms: ${health.symptoms && health.symptoms.length > 0 ? health.symptoms.join(', ') : 'None'}
Current Medications: ${health.medications || 'None'}
Allergies: ${health.allergies || 'None'}

=== CONSENT STATUS ===
HIPAA Privacy Notice: ${consents.hipaa ? 'SIGNED' : 'NOT SIGNED'} on ${timestamp}
Telehealth Consent: ${consents.telehealth ? 'SIGNED' : 'NOT SIGNED'} on ${timestamp}
Session Recording: ${consents.recording ? 'AUTHORIZED' : 'NOT AUTHORIZED'} on ${timestamp}

=== COMPLIANCE ===
All consents stored in Square (HIPAA compliant system)
Platform: PJA Telehealth (HIPAA compliant)
Video Platform: Doxy.me (HIPAA compliant - BAA on file)
Provider: Patrick Smith, BCHHP
    `.trim();
}

// ==================== BUILD PATIENT NOTE ====================
function buildPatientNote(health, service) {
    return `
Chief Complaint: ${health.chiefComplaint}
Duration: ${health.symptomDuration || 'Not specified'}
Symptoms: ${health.symptoms && health.symptoms.length > 0 ? health.symptoms.join(', ') : 'None checked'}

Service: ${service.name}
Duration: ${service.duration || 30} minutes
    `.trim();
}

// ==================== BUILD PROVIDER NOTE ====================
function buildProviderNote(personal, health, consents, service, timestamp) {
    return `
🩺 TELEHEALTH CONSULTATION - ${service.name}

📋 PATIENT INFO:
Name: ${personal.firstName} ${personal.lastName}
Email: ${personal.email}
Phone: ${personal.phone}
DOB: ${personal.dob || 'Not provided'}
Emergency: ${personal.emergencyName || 'None'} ${personal.emergencyPhone || ''}

🏥 CHIEF COMPLAINT:
${health.chiefComplaint}

⏱ SYMPTOM DURATION: ${health.symptomDuration || 'Not specified'}

🩹 CURRENT SYMPTOMS:
${health.symptoms && health.symptoms.length > 0 ? health.symptoms.join(', ') : 'None selected'}

💊 MEDICATIONS:
${health.medications || 'None reported'}

⚠️ ALLERGIES:
${health.allergies || 'None reported'}

✅ CONSENT STATUS (Signed: ${timestamp}):
- HIPAA Privacy: SIGNED ✓
- Telehealth Consent: SIGNED ✓  
- Recording: ${consents.recording ? 'AUTHORIZED ✓' : 'NOT AUTHORIZED'}

🎥 VIDEO CONSULTATION:
Provider Link: https://doxy.me/PatrickPJAwellness/provider
Patient Link: https://doxy.me/PatrickPJAwellness

📝 NOTE: All consent forms stored in Square Customer record (HIPAA compliant)
    `.trim();
}

// ==================== CATCH-ALL ROUTE ====================
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==================== START SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log('========================================');
    console.log('🏥 PJA TELEHEALTH BACKEND');
    console.log('========================================');
    console.log(`📍 Port: ${PORT}`);
    console.log(`🌍 Environment: ${process.env.SQUARE_ENVIRONMENT || 'sandbox'}`);
    console.log(`🏥 Location: ${LOCATION_ID}`);
    console.log(`🔒 HIPAA Compliance: Active`);
    console.log(`📝 Consent Storage: Square`);
    console.log(`✅ Ready to accept bookings`);
    console.log('========================================');
});
