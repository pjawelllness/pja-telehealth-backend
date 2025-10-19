require('dotenv').config();
const express = require('express');
const { Client, Environment } = require('square');
const cors = require('cors');
const path = require('path');
const { randomUUID } = require('crypto');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Square Client
const squareClient = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: process.env.SQUARE_ENVIRONMENT === 'production' ? Environment.Production : Environment.Sandbox
});

const LOCATION_ID = process.env.SQUARE_LOCATION_ID || 'LT1S9BE1EX0PW';
const PROVIDER_PASSWORD = process.env.PROVIDER_PASSWORD || 'PJA2025!Secure';

// Helper: Convert BigInt to String for JSON
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

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Serve index.html at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Get services
app.get('/api/services', async (req, res) => {
    try {
        console.log('Fetching services from Square...');
        const response = await squareClient.catalogApi.listCatalog(undefined, 'ITEM');
        console.log('Square response received');
        
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
        
        console.log(`Returning ${services.length} services`);
        res.setHeader('Content-Type', 'application/json');
        res.json({ services });
    } catch (error) {
        console.error('Error fetching services:', error);
        res.setHeader('Content-Type', 'application/json');
        res.status(500).json({ error: error.message, details: error.errors || [] });
    }
});

// Get availability
app.post('/api/availability', async (req, res) => {
    try {
        const { date, serviceId } = req.body;
        
        if (!date) {
            return res.status(400).json({ error: 'Date is required' });
        }

        // Create start and end of day in UTC
        const selectedDate = new Date(date);
        const startAt = new Date(selectedDate);
        startAt.setHours(0, 0, 0, 0);
        
        const endAt = new Date(selectedDate);
        endAt.setHours(23, 59, 59, 999);

        console.log('Searching availability:', {
            locationIds: [LOCATION_ID],
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

        console.log('Square API Response:', JSON.stringify(convertBigIntToString(response.result), null, 2));

        const availabilities = response.result.availabilities || [];
        
        // Filter for the specific date requested
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

        console.log('Filtered slots for', date, ':', filteredSlots.length);

        res.json({ 
            availabilities: filteredSlots,
            total: filteredSlots.length 
        });

    } catch (error) {
        console.error('Error fetching availability:', error);
        res.status(500).json({ error: error.message, details: error.errors });
    }
});

// Create or get customer
app.post('/api/customer', async (req, res) => {
    try {
        const { firstName, lastName, email, phone } = req.body;

        // Search for existing customer
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
        } else {
            // Create new customer
            const createResponse = await squareClient.customersApi.createCustomer({
                givenName: firstName,
                familyName: lastName,
                emailAddress: email,
                phoneNumber: phone
            });
            customerId = createResponse.result.customer.id;
        }

        res.json({ customerId });
    } catch (error) {
        console.error('Error with customer:', error);
        res.status(500).json({ error: error.message });
    }
});

// Save consent forms to customer notes
app.post('/api/save-consent', async (req, res) => {
    try {
        const { customerId, consentData } = req.body;

        const consentText = `
CONSENT FORMS COMPLETED: ${new Date().toLocaleString()}

HIPAA CONSENT: ${consentData.hipaaConsent ? 'AGREED' : 'NOT AGREED'}
TELEHEALTH CONSENT: ${consentData.telehealthConsent ? 'AGREED' : 'NOT AGREED'}
INFORMED CONSENT: ${consentData.informedConsent ? 'AGREED' : 'NOT AGREED'}

PATIENT INFORMATION:
- Name: ${consentData.patientName}
- DOB: ${consentData.dob}
- Phone: ${consentData.phone}
- Email: ${consentData.email}
- Address: ${consentData.address}

EMERGENCY CONTACT:
- Name: ${consentData.emergencyName}
- Phone: ${consentData.emergencyPhone}
- Relationship: ${consentData.emergencyRelationship}

MEDICAL INFORMATION:
- Primary Concerns: ${consentData.primaryConcerns}
- Current Medications: ${consentData.currentMedications}
- Allergies: ${consentData.allergies}
- Medical History: ${consentData.medicalHistory}

INSURANCE:
- Provider: ${consentData.insuranceProvider}
- Member ID: ${consentData.insuranceMemberId}
- Group Number: ${consentData.insuranceGroupNumber}

IP Address: ${req.ip}
User Agent: ${req.get('user-agent')}
        `;

        await squareClient.customersApi.updateCustomer(customerId, {
            note: consentText
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error saving consent:', error);
        res.status(500).json({ error: error.message });
    }
});

// Process payment
app.post('/api/process-payment', async (req, res) => {
    try {
        const { sourceId, amount, customerId, serviceId, appointmentDetails } = req.body;

        console.log('Processing payment:', { sourceId, amount, customerId, serviceId });

        // Create payment
        const paymentResponse = await squareClient.paymentsApi.createPayment({
            sourceId: sourceId,
            idempotencyKey: randomUUID(),
            amountMoney: {
                amount: BigInt(Math.round(amount * 100)), // Convert dollars to cents
                currency: 'USD'
            },
            customerId: customerId,
            locationId: LOCATION_ID,
            note: `Payment for ${appointmentDetails.serviceName} - ${appointmentDetails.date} at ${appointmentDetails.time}`
        });

        console.log('Payment successful:', paymentResponse.result.payment.id);

        // Save payment info to customer notes
        const paymentNote = `
PAYMENT PROCESSED: ${new Date().toLocaleString()}
Payment ID: ${paymentResponse.result.payment.id}
Amount: $${amount}
Service: ${appointmentDetails.serviceName}
Appointment: ${appointmentDetails.date} at ${appointmentDetails.time}
        `;

        await squareClient.customersApi.updateCustomer(customerId, {
            note: paymentNote
        });

        res.json({ 
            success: true, 
            paymentId: paymentResponse.result.payment.id,
            receipt: paymentResponse.result.payment.receiptUrl
        });

    } catch (error) {
        console.error('Payment error:', error);
        res.status(400).json({ 
            error: error.message,
            details: error.errors 
        });
    }
});

// Create booking (only called AFTER successful payment)
app.post('/api/book', async (req, res) => {
    try {
        const { customerId, startAt, serviceVariationId, paymentId } = req.body;

        console.log('Creating booking:', { customerId, startAt, serviceVariationId, paymentId });

        // Get service variation details
        const catalogResponse = await squareClient.catalogApi.retrieveCatalogObject(serviceVariationId);
        const serviceVariation = catalogResponse.result.object;
        const durationMinutes = parseInt(serviceVariation.itemVariationData.serviceDuration) / 60000 || 60;

        // Create booking
        const bookingResponse = await squareClient.bookingsApi.createBooking({
            booking: {
                customerId: customerId,
                locationId: LOCATION_ID,
                startAt: startAt,
                appointmentSegments: [{
                    durationMinutes: durationMinutes,
                    serviceVariationId: serviceVariationId,
                    teamMemberId: 'TMpFuwQXkVSLNjOK', // Patrick Smith's ID
                    serviceVariationVersion: BigInt(serviceVariation.version || 1)
                }]
            }
        });

        // Add payment reference to booking notes
        const bookingNote = `Payment ID: ${paymentId}\nPaid: $${req.body.amount || '99.00'}`;
        
        res.json({ 
            success: true, 
            bookingId: bookingResponse.result.booking.id,
            paymentId: paymentId
        });

    } catch (error) {
        console.error('Booking error:', error);
        res.status(400).json({ 
            error: error.message,
            details: error.errors 
        });
    }
});

// Provider Portal - Login
app.post('/api/provider/login', async (req, res) => {
    const { password } = req.body;
    
    if (password === PROVIDER_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, error: 'Invalid password' });
    }
});

// Provider Portal - Get bookings
app.get('/api/provider/bookings', async (req, res) => {
    try {
        const password = req.headers.authorization?.replace('Bearer ', '');
        
        if (password !== PROVIDER_PASSWORD) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Get bookings starting from today
        const startAtMin = new Date().toISOString();
        const startAtMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(); // Next 90 days

        const bookingsResponse = await squareClient.bookingsApi.listBookings(
            undefined, // limit
            undefined, // cursor
            undefined, // customerId
            undefined, // teamMemberId
            LOCATION_ID,
            startAtMin,
            startAtMax
        );

        const bookings = bookingsResponse.result.bookings || [];

        // Get customer details for each booking
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
                        service: booking.appointmentSegments?.[0]?.serviceVariationId || 'Unknown'
                    };
                } catch (err) {
                    console.error('Error fetching customer:', err);
                    return {
                        id: booking.id,
                        startAt: booking.startAt,
                        customerName: 'Unknown',
                        status: booking.status
                    };
                }
            })
        );

        // Sort by date
        enrichedBookings.sort((a, b) => new Date(a.startAt) - new Date(b.startAt));

        res.json({ bookings: convertBigIntToString(enrichedBookings) });

    } catch (error) {
        console.error('Error fetching bookings:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`✅ Environment: ${process.env.SQUARE_ENVIRONMENT || 'sandbox'}`);
    console.log(`✅ Location ID: ${LOCATION_ID}`);
    console.log(`✅ Provider Portal: Enabled`);
    console.log(`✅ Payment Processing: Enabled`);
});
