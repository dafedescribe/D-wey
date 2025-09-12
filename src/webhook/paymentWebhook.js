const crypto = require('crypto')
const PaymentService = require('../services/paymentService')

// Store WhatsApp socket instance
let whatsappSocket = null

function setWhatsAppSocket(sock) {
    whatsappSocket = sock
}

async function handlePaystackWebhook(req, res) {
    try {
        // Verify webhook signature
        const hash = crypto
            .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
            .update(JSON.stringify(req.body))
            .digest('hex')

        if (hash !== req.headers['x-paystack-signature']) {
            console.log('❌ Invalid webhook signature')
            return res.status(400).send('Invalid signature')
        }

        const event = req.body

        if (event.event === 'charge.success') {
            const { reference, status } = event.data
            
            console.log(`💰 Payment webhook: ${reference} - ${status}`)

            // Update payment status in database
            const user = await PaymentService.updatePaymentStatus(reference, 'success')
            
            if (user && whatsappSocket) {
                // Send confirmation message to user
                const phoneJid = `${user.phone_number}@s.whatsapp.net`
                const message = `🎉 *Payment Successful!*

✅ Your payment has been confirmed
💰 Reference: ${reference}
👤 Name: ${user.display_name}

_Thank you for your payment!_`

                await whatsappSocket.sendMessage(phoneJid, { text: message })
                console.log(`✅ Confirmation sent to: ${user.phone_number}`)
            }
        }

        res.status(200).send('OK')
    } catch (error) {
        console.error('❌ Webhook error:', error.message)
        res.status(500).send('Webhook error')
    }
}

module.exports = { handlePaystackWebhook, setWhatsAppSocket }