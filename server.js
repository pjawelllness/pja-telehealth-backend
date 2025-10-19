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

// Doxy.me Configuration - YOUR ACTUAL ROOM
const DOXY_ROOM_URL = process.env.DOXY_ROOM_URL || 'https://doxy.me/PatrickPJAwellness';
const PROVIDER_NAME = 'Patrick Smith, Board Certified Healthcare Provider';

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

// Helper: Generate appointment confirmation email
async function generateAppointmentEmail(customerEmail, appointmentDetails) {
    const emailContent = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏥 PJA WELLNESS - APPOINTMENT CONFIRMATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Dear ${appointmentDetails.patientName},

Your telehealth appointment has been successfully confirmed!

📅 APPOINTMENT DETAILS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Date: ${appointmentDetails.date}
Time: ${appointmentDetails.time}
Service: ${appointmentDetails.serviceName}
Provider: ${PROVIDER_NAME}
Amount Paid: $${appointmentDetails.amount}

💻 YOUR TELEHEALTH ROOM:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${DOXY_ROOM_URL}

Click the link above at your appointment time to join!

⏰ IMPORTANT REMINDERS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ You will receive a reminder 24 hours before
✅ Join 5 minutes early to test audio/video
✅ Have your ID and insurance card ready
✅ Use a private, quiet location with good lighting

📋 WHAT TO PREPARE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Computer, tablet, or smartphone with camera
• Good internet connection
• List of current medications
• Any relevant medical documents

🔧 TECHNICAL SUPPORT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If you have trouble connecting:
1. Try a different browser (Chrome recommended)
2. Check camera/microphone permissions
3. Test at: ${DOXY_ROOM_URL}

❓ QUESTIONS OR NEED TO RESCHEDULE?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Email: support@pjawellness.com
Phone: 1-800-PJA-WELLNESS

We look forward to serving you!

Best regards,
PJA Wellness Team

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This is an automated confirmation from PJA Wellness
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `;
    
    console.log('📧 Appointment confirmation generated for:', customerEmail);
    return emailContent;
}

// ============================================
// API ROUTES (MUST COME BEFORE STATIC FILES!)
// ============================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        doxyRoom: DOXY_ROOM_URL 
    });
});

// Get services
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

// Get availability for a specific date
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

        console.log('🔍 Searching availability for Patrick Smith:', {
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

        console.log(`✅ Found ${filteredSlots.length} available slots for ${date}`);

        res.json({ 
            availabilities: filteredSlots,
            total: filteredSlots.length 
        });

    } catch (error) {
        console.error('❌ Error fetching availability:', error);
        res.status(500).json({ error: error.message, details: error.errors });
    }
});

// Create or get customer
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

// Save consent forms and patient data to customer notes
app.post('/api/save-consent', async (req, res) => {
    try {
        const { customerId, consentData } = req.body;

        const consentText = `
╔════════════════════════════════════════════════════════════╗
║        PATIENT INTAKE & CONSENT FORMS                      ║
║        Completed: ${new Date().toLocaleString()}                       ║
╚════════════════════════════════════════════════════════════╝

📋 CONSENT STATUS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ HIPAA Consent: ${consentData.hipaaConsent ? 'AGREED' : 'NOT AGREED'}
✅ Telehealth Consent: ${consentData.telehealthConsent ? 'AGREED' : 'NOT AGREED'}
✅ Informed Consent: ${consentData.informedConsent ? 'AGREED' : 'NOT AGREED'}

👤 PATIENT INFORMATION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name: ${consentData.patientName}
DOB: ${consentData.dob}
Phone: ${consentData.phone}
Email: ${consentData.email}
Address: ${consentData.address}

🚨 EMERGENCY CONTACT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name: ${consentData.emergencyName}
Phone: ${consentData.emergencyPhone}
Relationship: ${consentData.emergencyRelationship}

🏥 CHIEF COMPLAINT & MEDICAL HISTORY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Primary Concerns: ${consentData.primaryConcerns}

Current Medications: 
${consentData.currentMedications || 'None reported'}

Known Allergies: 
${consentData.allergies || 'None reported'}

Medical History: 
${consentData.medicalHistory || 'None reported'}

💳 INSURANCE INFORMATION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Provider: ${consentData.insuranceProvider || 'Self-pay / HSA/FSA'}
Member ID: ${consentData.insuranceMemberId || 'N/A'}
Group Number: ${consentData.insuranceGroupNumber || 'N/A'}

🔐 VERIFICATION & SECURITY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IP Address: ${req.ip}
User Agent: ${req.get('user-agent')}
Timestamp: ${new Date().toISOString()}

╚════════════════════════════════════════════════════════════╝
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

// Process payment with Square
app.post('/api/process-payment', async (req, res) => {
    try {
        const { sourceId, amount, customerId, serviceId, appointmentDetails } = req.body;

        console.log('💳 Processing payment:', { 
            amount: `$${amount}`, 
            customerId, 
            service: appointmentDetails.serviceName 
        });

        const paymentResponse = await squareClient.paymentsApi.createPayment({
            sourceId: sourceId,
            idempotencyKey: randomUUID(),
            amountMoney: {
                amount: BigInt(Math.round(amount * 100)),
                currency: 'USD'
            },
            customerId: customerId,
            locationId: LOCATION_ID,
            note: `Telehealth: ${appointmentDetails.serviceName} - ${appointmentDetails.date} at ${appointmentDetails.time}`
        });

        console.log('✅ Payment successful! ID:', paymentResponse.result.payment.id);

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

// Create booking in Square (only after successful payment)
app.post('/api/book', async (req, res) => {
    try {
        const { 
            customerId, 
            startAt, 
            serviceVariationId, 
            paymentId, 
            patientName, 
            patientEmail, 
            appointmentDetails 
        } = req.body;

        console.log('📅 Creating booking in Square Calendar...');

        // Get service details
        const catalogResponse = await squareClient.catalogApi.retrieveCatalogObject(serviceVariationId);
        const serviceVariation = catalogResponse.result.object;
        const durationMinutes = parseInt(serviceVariation.itemVariationData.serviceDuration) / 60000 || 60;

        // Create booking in Square
        const bookingResponse = await squareClient.bookingsApi.createBooking({
            booking: {
                customerId: customerId,
                locationId: LOCATION_ID,
                startAt: startAt,
                appointmentSegments: [{
                    durationMinutes: durationMinutes,
                    serviceVariationId: serviceVariationId,
                    teamMemberId: 'TMpFuwQXkVSLNjOK', // Patrick Smith
                    serviceVariationVersion: BigInt(serviceVariation.version || 1)
                }]
            }
        });

        console.log('✅ Booking created! ID:', bookingResponse.result.booking.id);

        // Generate appointment confirmation email
        const emailContent = await generateAppointmentEmail(patientEmail, {
            patientName: patientName,
            date: appointmentDetails.date,
            time: appointmentDetails.time,
            serviceName: appointmentDetails.serviceName,
            amount: req.body.amount
        });

        // Append appointment details to customer notes
        const appointmentNote = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 APPOINTMENT BOOKED: ${new Date().toLocaleString()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Booking ID: ${bookingResponse.result.booking.id}
Payment ID: ${paymentId}
Amount Paid: $${req.body.amount}

Service: ${appointmentDetails.serviceName}
Date: ${appointmentDetails.date}
Time: ${appointmentDetails.time}

💻 TELEHEALTH ROOM:
Patient Link: ${DOXY_ROOM_URL}
Provider Link: ${DOXY_ROOM_URL}/provider

${emailContent}
        `;

        // Update customer with appointment info
        const currentCustomer = await squareClient.customersApi.retrieveCustomer(customerId);
        const existingNote = currentCustomer.result.customer.note || '';
        
        await squareClient.customersApi.updateCustomer(customerId, {
            note: existingNote + '\n\n' + appointmentNote
        });

        console.log('✅ Appointment confirmation saved to customer record');
        
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

// Provider Portal - Login
app.post('/api/provider/login', async (req, res) => {
    const { password } = req.body;
    
    if (password === PROVIDER_PASSWORD) {
        console.log('✅ Provider login successful');
        res.json({ success: true });
    } else {
        console.log('❌ Provider login failed - invalid password');
        res.status(401).json({ success: false, error: 'Invalid password' });
    }
});

// Provider Portal - Get all upcoming bookings
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
                        customerNotes: customer.note || 'No patient information available',
                        status: booking.status,
                        service: booking.appointmentSegments?.[0]?.serviceVariationId || 'Unknown',
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

// ============================================
// STATIC FILES (MUST COME AFTER API ROUTES!)
// ============================================

app.use(express.static(__dirname));

// Serve index.html at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Catch-all route
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
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     🏥 PJA WELLNESS TELEHEALTH PLATFORM                   ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`✅ Server running on port: ${PORT}`);
    console.log(`✅ Environment: ${process.env.SQUARE_ENVIRONMENT || 'sandbox'}`);
    console.log(`✅ Location ID: ${LOCATION_ID}`);
    console.log(`✅ Provider Portal: Enabled (password protected)`);
    console.log(`✅ Payment Processing: Square Payments SDK`);
    console.log(`✅ Doxy.me Room: ${DOXY_ROOM_URL}`);
    console.log(`✅ Provider Link: ${DOXY_ROOM_URL}/provider`);
    console.log('');
    console.log('Ready to accept telehealth appointments! 🚀');
    console.log('');
});
