// PJA Telehealth Backend - Simplified Version
// Square handles all email/SMS notifications automatically!

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client, Environment } = require('square');

const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID || 'LT1S9BE1EX0PW';
const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT === 'production' ? 
    Environment.Production : Environment.Sandbox;

// Initialize Square client
const squareClient = new Client({
    accessToken: SQUARE_ACCESS_TOKEN,
    environment: SQUARE_ENVIRONMENT
});

// Service ID mapping
const SERVICE_IDS = {
    'comprehensive': 'Q4SB3C5I3XLEGYGRDZ475EPR',
    'followup': 'SK7RLVBQI7CW6VM6PZLVIBKJ',
    'acute': 'RD372EFPIMXOOGCXSA7IFDTJ'
};

// =====================================================
// HEALTH CHECK ENDPOINT
// =====================================================
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'PJA Telehealth Backend is running!',
        environment: SQUARE_ENVIRONMENT,
        timestamp: new Date().toISOString()
    });
});

// =====================================================
// GET AVAILABLE TIME SLOTS
// =====================================================
app.post('/api/availability', async (req, res) => {
    try {
        const { date, serviceType } = req.body;
        
        const catalogObjectId = SERVICE_IDS[serviceType];
        if (!catalogObjectId) {
            return res.status(400).json({ error: 'Invalid service type' });
        }

        // Search for available slots
        const response = await squareClient.bookingsApi.searchAvailability({
            query: {
                filter: {
                    locationId: SQUARE_LOCATION_ID,
                    segmentFilters: [{
                        serviceVariationId: catalogObjectId,
                        teamMemberIdFilter: {
                            any: ['TMpDyughFdZTf6ID'] // Your team member ID
                        }
                    }],
                    startAtRange: {
                        startAt: `${date}T00:00:00Z`,
                        endAt: `${date}T23:59:59Z`
                    }
                }
            }
        });

        const availabilities = response.result.availabilities || [];
        const timeSlots = availabilities.map(slot => ({
            startAt: slot.startAt,
            appointmentSegments: slot.appointmentSegments
        }));

        res.json({ 
            success: true, 
            availableSlots: timeSlots 
        });

    } catch (error) {
        console.error('Availability check error:', error);
        res.status(500).json({ 
            error: 'Failed to check availability',
            message: error.message 
        });
    }
});

// =====================================================
// CREATE BOOKING
// =====================================================
app.post('/api/bookings', async (req, res) => {
    try {
        const {
            serviceType,
            firstName,
            lastName,
            email,
            phone,
            appointmentDate,
            appointmentTime,
            dob,
            address,
            city,
            state,
            zip,
            chiefConcern,
            medications,
            allergies
        } = req.body;

        // Get the catalog object ID for the service
        const catalogObjectId = SERVICE_IDS[serviceType];
        if (!catalogObjectId) {
            return res.status(400).json({ error: 'Invalid service type' });
        }

        // Combine date and time
        const startAt = `${appointmentDate}T${appointmentTime}:00`;

        // Create customer note with health information
        const customerNote = `
Chief Concern: ${chiefConcern}
DOB: ${dob}
Address: ${address}, ${city}, ${state} ${zip}
${medications ? `Medications: ${medications}` : ''}
${allergies ? `Allergies: ${allergies}` : ''}
        `.trim();

        // Create the booking in Square
        const bookingResponse = await squareClient.bookingsApi.createBooking({
            booking: {
                locationId: SQUARE_LOCATION_ID,
                startAt: startAt,
                customerNote: customerNote,
                customerId: undefined, // Square will create customer if needed
                appointmentSegments: [{
                    durationMinutes: serviceType === 'comprehensive' ? 60 : 
                                    serviceType === 'followup' ? 30 : 20,
                    serviceVariationId: catalogObjectId,
                    teamMemberId: 'TMpDyughFdZTf6ID',
                    serviceVariationVersion: 1
                }]
            },
            idempotencyKey: `booking-${Date.now()}-${Math.random()}`
        });

        const booking = bookingResponse.result.booking;

        console.log('✅ Booking created successfully:', booking.id);
        console.log('📧 Square will send email/SMS notifications automatically');

        res.json({
            success: true,
            bookingId: booking.id,
            message: 'Appointment booked successfully! You will receive confirmation via email and SMS from Square.',
            booking: {
                id: booking.id,
                startAt: booking.startAt,
                status: booking.status,
                doxyLink: `https://doxy.me/PatrickPJAwellness`
            }
        });

    } catch (error) {
        console.error('Booking creation error:', error);
        res.status(500).json({ 
            error: 'Failed to create booking',
            message: error.message,
            details: error.errors || []
        });
    }
});

// =====================================================
// GET BOOKINGS (For Provider Dashboard)
// =====================================================
app.get('/api/bookings', async (req, res) => {
    try {
        const response = await squareClient.bookingsApi.listBookings({
            locationId: SQUARE_LOCATION_ID,
            limit: 100
        });

        const bookings = response.result.bookings || [];

        res.json({
            success: true,
            bookings: bookings.map(booking => ({
                id: booking.id,
                startAt: booking.startAt,
                status: booking.status,
                customerNote: booking.customerNote,
                customerId: booking.customerId
            }))
        });

    } catch (error) {
        console.error('Failed to fetch bookings:', error);
        res.status(500).json({ 
            error: 'Failed to fetch bookings',
            message: error.message 
        });
    }
});

// =====================================================
// PROCESS PAYMENT
// =====================================================
app.post('/api/payments', async (req, res) => {
    try {
        const { sourceId, amount, bookingId } = req.body;

        const paymentResponse = await squareClient.paymentsApi.createPayment({
            sourceId: sourceId,
            amountMoney: {
                amount: amount, // Amount in cents
                currency: 'USD'
            },
            locationId: SQUARE_LOCATION_ID,
            referenceId: bookingId,
            idempotencyKey: `payment-${Date.now()}-${Math.random()}`
        });

        const payment = paymentResponse.result.payment;

        res.json({
            success: true,
            paymentId: payment.id,
            status: payment.status,
            receiptUrl: payment.receiptUrl
        });

    } catch (error) {
        console.error('Payment processing error:', error);
        res.status(500).json({ 
            error: 'Payment failed',
            message: error.message 
        });
    }
});

// =====================================================
// START SERVER
// =====================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 PJA Telehealth Backend running on port ${PORT}`);
    console.log(`📍 Environment: ${SQUARE_ENVIRONMENT}`);
    console.log(`📧 Square will handle all email/SMS notifications`);
    console.log(`✅ Health check: http://localhost:${PORT}/health`);
});
