require('dotenv').config();
const express = require('express');
const { Client, Environment } = require('square');
const cors = require('cors');
const path = require('path');
const { randomUUID } = require('crypto');

const app = express();

app.use(cors());
app.use(express.json());

// Square Client
const squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: process.env.SQUARE_ENVIRONMENT === 'production' ? Environment.Production : Environment.Sandbox
});

const LOCATION_ID = process.env.SQUARE_LOCATION_ID || 'LT1S9BE1EX0PW';
const PROVIDER_PASSWORD = process.env.PROVIDER_PASSWORD || 'PJA2025!Secure';
const DOXY_ROOM_URL = process.env.DOXY_ROOM_URL || 'https://doxy.me/PatrickPJAwellness';
const PROVIDER_NAME = 'Patrick Smith, Board Certified Healthcare Provider';

// Helper functions
function convertBigIntToString(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'bigint') return obj.toString();
    if (Array.isArray(obj)) return obj.map(convertBigIntToString);
    if (typeof obj === 'object') {
        const converted = {};
        for (const key in obj) {
            converted[key] = convertBigIntToString(obj[key]);
        }
        return converted;
    }
    return obj;
}

// ========================================
// API ROUTES (MUST COME BEFORE STATIC FILES!)
// ========================================

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        doxyRoom: DOXY_ROOM_URL 
    });
});

app.get('/api/services', async (req, res) => {
    try {
        console.log('📋 Fetching services from Square...');
        const response = await squareClient.catalogApi.listCatalog(undefined, 'ITEM');
        console.log('✅ Square response received');
        
        const services = response.result.objects
            ?.filter(obj => obj.type === 'ITEM')
            .map(item => {
                const amount = item.itemData.variations?.[0]?.itemVariationData?.priceMoney?.amount;
                return {
                    id: item.id,
                    name: item.itemData.name,
                    description: item.itemData.description || '',
                    price: amount ? (Number(amount) / 100).toFixed(2) : '99.00',
                    variationId: item.itemData.variations?.[0]?.id
                };
            }) || [];
        
        console.log(`✅ Returning ${services.length} services`);
        res.json({ services });
    } catch (error) {
        console.error('❌ Error fetching services:', error);
        res.status(500).json({ error: error.message, details: error.errors || [] });
    }
});

app.post('/api/availability', async (req, res) => {
    try {
        const { date, serviceId } = req.body;
        
        if (!date) {
            return res.status(400).json({ error: 'Date is required' });
        }

        const selectedDate = new Date(date);
        const startAt = new Date(selectedDate);
        startAt.setHours(0, 0, 0, 0);
        
        const endAt = new Date(selectedDate);
        endAt.setHours(23, 59, 59, 999);

        console.log('🔍 Searching availability:', {
            locationId: LOCATION_ID,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString()
        });

        const response = await squareClient.bookingsApi.searchAvailability({
            query: {
                filter: {
                    locationId: LOCATION_ID,
                    startAtRange: {
                        startAt: startAt.toISOString(),
                        endAt: endAt.toISOString()
                    }
                }
            }
        });

        const availabilities = response.result.availabilities || [];
        
        const filteredSlots = availabilities
            .filter(slot => {
                const slotDate = new Date(slot.startAt);
                return slotDate.toDateString() === selectedDate.toDateString();
            })
            .map(slot => {
                const startTime = new Date(slot.startAt);
                return {
                    startAt: slot.startAt,
                    time: startTime.toLocaleTimeString('en-US', { 
                        hour: 'numeric', 
                        minute: '2-digit',
                        hour12: true,
                        timeZone: 'America/New_York'
                    })
                };
            })
            .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

        console.log(`✅ Found ${filteredSlots.length} slots for ${date}`);

        res.json({ 
            availabilities: filteredSlots,
            total: filteredSlots.length 
        });

    } catch (error) {
        console.error('❌ Error fetching availability:', error);
        res.status(500).json({ error: error.message, details: error.errors });
    }
});

app.post('/api/customer', async (req, res) => {
    try {
        const { firstName, lastName, email, phone } = req.body;

        console.log('👤 Creating/finding customer:', email);

        const searchResponse = await squareClient.customersApi.searchCustomers({
            query: {
                filter: {
                    emailAddress: { exact: email }
                }
            }
        });

        let customerId;
        
        if (searchResponse.result.customers && searchResponse.result.customers.length > 0) {
            customerId = searchResponse.result.customers[0].id;
            console.log('✅ Found existing customer:', customerId);
        } else {
            const createResponse = await squareClient.customersApi.createCustomer({
                givenName: firstName,
                familyName: lastName,
                emailAddress: email,
                phoneNumber: phone
            });
            customerId = createResponse.result.customer.id;
            console.log('✅ Created new customer:', customerId);
        }

        res.json({ customerId });
    } catch (error) {
        console.error('❌ Error with customer:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/save-consent', async (req, res) => {
    try {
        const { customerId, consentData } = req.body;

        const consentText = `
CONSENT FORMS - ${new Date().toLocaleString()}

HIPAA: ${consentData.hipaaConsent ? 'AGREED' : 'NOT AGREED'}
Telehealth: ${consentData.telehealthConsent ? 'AGREED' : 'NOT AGREED'}
Treatment: ${consentData.informedConsent ? 'AGREED' : 'NOT AGREED'}

PATIENT: ${consentData.patientName}
DOB: ${consentData.dob}
EMAIL: ${consentData.email}
PHONE: ${consentData.phone}
ADDRESS: ${consentData.address}

EMERGENCY CONTACT: ${consentData.emergencyName}
EMERGENCY PHONE: ${consentData.emergencyPhone}
RELATIONSHIP: ${consentData.emergencyRelationship}

CONCERNS: ${consentData.primaryConcerns}
MEDICATIONS: ${consentData.currentMedications}
ALLERGIES: ${consentData.allergies}
HISTORY: ${consentData.medicalHistory}

INSURANCE: ${consentData.insuranceProvider}
MEMBER ID: ${consentData.insuranceMemberId}
GROUP: ${consentData.insuranceGroupNumber}
        `;

        await squareClient.customersApi.updateCustomer(customerId, {
            note: consentText
        });

        console.log('✅ Consent forms saved for customer:', customerId);
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Error saving consent:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/process-payment', async (req, res) => {
    try {
        const { sourceId, amount, customerId, serviceId, appointmentDetails } = req.body;

        console.log('💳 Processing payment:', { amount, customerId });

        const paymentResponse = await squareClient.paymentsApi.createPayment({
            sourceId: sourceId,
            idempotencyKey: randomUUID(),
            amountMoney: {
                amount: BigInt(Math.round(amount * 100)),
                currency: 'USD'
            },
            customerId: customerId,
            locationId: LOCATION_ID,
            note: `${appointmentDetails.serviceName} - ${appointmentDetails.date} at ${appointmentDetails.time}`
        });

        console.log('✅ Payment successful:', paymentResponse.result.payment.id);

        res.json({ 
            success: true, 
            paymentId: paymentResponse.result.payment.id,
            receipt: paymentResponse.result.payment.receiptUrl
        });

    } catch (error) {
        console.error('❌ Payment error:', error);
        res.status(400).json({ 
            error: error.message,
            details: error.errors 
        });
    }
});

app.post('/api/book', async (req, res) => {
    try {
        const { customerId, startAt, serviceVariationId, paymentId, patientName, patientEmail, appointmentDetails } = req.body;

        console.log('📅 Creating booking:', { customerId, startAt });

        const catalogResponse = await squareClient.catalogApi.retrieveCatalogObject(serviceVariationId);
        const serviceVariation = catalogResponse.result.object;
        const durationMinutes = parseInt(serviceVariation.itemVariationData.serviceDuration) / 60000 || 60;

        const bookingResponse = await squareClient.bookingsApi.createBooking({
            booking: {
                customerId: customerId,
                locationId: LOCATION_ID,
                startAt: startAt,
                appointmentSegments: [{
                    durationMinutes: durationMinutes,
                    serviceVariationId: serviceVariationId,
                    teamMemberId: 'TMpFuwQXkVSLNjOK',
                    serviceVariationVersion: BigInt(serviceVariation.version || 1)
                }]
            }
        });

        console.log('✅ Booking created:', bookingResponse.result.booking.id);

        const appointmentNote = `
APPOINTMENT - ${new Date().toLocaleString()}
Booking ID: ${bookingResponse.result.booking.id}
Payment ID: ${paymentId}
Amount: $${req.body.amount}

Service: ${appointmentDetails.serviceName}
Date: ${appointmentDetails.date}
Time: ${appointmentDetails.time}

TELEHEALTH ROOM: ${DOXY_ROOM_URL}
PROVIDER LINK: ${DOXY_ROOM_URL}/provider
        `;

        const currentCustomer = await squareClient.customersApi.retrieveCustomer(customerId);
        const existingNote = currentCustomer.result.customer.note || '';
        
        await squareClient.customersApi.updateCustomer(customerId, {
            note: existingNote + '\n\n' + appointmentNote
        });

        console.log('✅ Appointment details saved');
        
        res.json({ 
            success: true, 
            bookingId: bookingResponse.result.booking.id,
            paymentId: paymentId,
            doxyRoomUrl: DOXY_ROOM_URL
        });

    } catch (error) {
        console.error('❌ Booking error:', error);
        res.status(400).json({ 
            error: error.message,
            details: error.errors 
        });
    }
});

app.post('/api/provider/login', async (req, res) => {
    const { password } = req.body;
    
    if (password === PROVIDER_PASSWORD) {
        console.log('✅ Provider login successful');
        res.json({ success: true });
    } else {
        console.log('❌ Provider login failed');
        res.status(401).json({ success: false, error: 'Invalid password' });
    }
});

app.get('/api/provider/bookings', async (req, res) => {
    try {
        const password = req.headers.authorization?.replace('Bearer ', '');
        
        if (password !== PROVIDER_PASSWORD) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const startAtMin = new Date().toISOString();
        const startAtMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

        console.log('📋 Fetching provider bookings...');

        const bookingsResponse = await squareClient.bookingsApi.listBookings(
            undefined,
            undefined,
            undefined,
            undefined,
            LOCATION_ID,
            startAtMin,
            startAtMax
        );

        const bookings = bookingsResponse.result.bookings || [];

        const enrichedBookings = await Promise.all(
            bookings.map(async (booking) => {
                try {
                    const customerResponse = await squareClient.customersApi.retrieveCustomer(booking.customerId);
                    const customer = customerResponse.result.customer;
                    
                    return {
                        id: booking.id,
                        startAt: booking.startAt,
                        customerName: `${customer.givenName || ''} ${customer.familyName || ''}`.trim(),
                        customerEmail: customer.emailAddress,
                        customerPhone: customer.phoneNumber,
                        customerNotes: customer.note || 'No notes',
                        status: booking.status,
                        doxyRoomUrl: DOXY_ROOM_URL,
                        providerLink: `${DOXY_ROOM_URL}/provider`
                    };
                } catch (err) {
                    console.error('Error fetching customer:', err);
                    return {
                        id: booking.id,
                        startAt: booking.startAt,
                        customerName: 'Unknown',
                        status: booking.status,
                        doxyRoomUrl: DOXY_ROOM_URL
                    };
                }
            })
        );

        enrichedBookings.sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

        console.log(`✅ Returning ${enrichedBookings.length} appointments`);

        res.json({ bookings: convertBigIntToString(enrichedBookings) });

    } catch (error) {
        console.error('❌ Error fetching bookings:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// STATIC FILES (MUST COME AFTER API ROUTES!)
// ========================================

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
        res.sendFile(path.join(__dirname, 'index.html'));
    } else {
        res.status(404).json({ error: 'API endpoint not found' });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('');
    console.log('════════════════════════════════════════');
    console.log('   🏥 PJA WELLNESS TELEHEALTH PLATFORM   ');
    console.log('════════════════════════════════════════');
    console.log('');
    console.log(`✅ Server running on port: ${PORT}`);
    console.log(`✅ Environment: ${process.env.SQUARE_ENVIRONMENT || 'sandbox'}`);
    console.log(`✅ Location ID: ${LOCATION_ID}`);
    console.log(`✅ Provider Portal: Enabled`);
    console.log(`✅ Payment Processing: Square`);
    console.log(`✅ Doxy.me Room: ${DOXY_ROOM_URL}`);
    console.log(`✅ Provider Link: ${DOXY_ROOM_URL}/provider`);
    console.log('');
    console.log('Ready to accept appointments! 🚀');
    console.log('');
});
