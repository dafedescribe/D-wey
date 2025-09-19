const crypto = require('crypto')
const PaymentService = require('../services/paymentService')

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
        console.log(`📡 Webhook: ${event.event} - ${event.data?.reference}`)

        // Handle different payment events with SIMPLE messages
        switch (event.event) {
            case 'charge.success':
                await handleSuccessfulPayment(event.data)
                break
            case 'charge.failed':
                await handleFailedPayment(event.data)
                break
            case 'charge.cancelled':
            case 'charge.abandoned':
                await handleCancelledPayment(event.data)
                break
            case 'charge.reversed':
            case 'refund.processed':
                await handleReversedPayment(event.data)
                break
            default:
                console.log(`ℹ️ Unhandled event: ${event.event}`)
        }

        res.status(200).send('OK')
    } catch (error) {
        console.error('❌ Webhook error:', error.message)
        res.status(500).send('Error')
    }
}

// SIMPLIFIED SUCCESS MESSAGE
async function handleSuccessfulPayment(data) {
    const { reference, amount, channel } = data
    
    if (channel !== 'card') return
    
    const result = await PaymentService.completePayment(reference)
    
    if (result && whatsappSocket) {
        const { user, transaction, newBalance } = result
        const phoneJid = `${user.phone_number}@s.whatsapp.net`
        
        // SUPER SIMPLE SUCCESS MESSAGE
        const message = `✅ Payment successful!\n\n+${transaction.tums_amount} coins\nBalance: ${newBalance} coins\n\nThanks ${user.display_name}! 🎉`

        await whatsappSocket.sendMessage(phoneJid, { text: message })
        console.log(`✅ Payment success: ${user.phone_number} - ${transaction.tums_amount} coins`)
    }
}

// SIMPLIFIED FAILURE MESSAGE
async function handleFailedPayment(data) {
    const { reference, gateway_response } = data
    
    const pendingData = await PaymentService.getPendingTransaction(reference)
    
    if (pendingData && whatsappSocket) {
        const { user, transaction } = pendingData
        const phoneJid = `${user.phone_number}@s.whatsapp.net`
        
        // SUPER SIMPLE FAILURE MESSAGE
        const failureReason = getSimpleFailureReason(gateway_response)
        const message = `❌ Payment failed\n\n${failureReason}\n\nTry: pay ${transaction.naira_amount}`

        await whatsappSocket.sendMessage(phoneJid, { text: message })
        console.log(`❌ Payment failed: ${user.phone_number}`)
    }
}

// SIMPLIFIED CANCELLATION MESSAGE  
async function handleCancelledPayment(data) {
    const { reference } = data
    
    const pendingData = await PaymentService.getPendingTransaction(reference)
    
    if (pendingData && whatsappSocket) {
        const { user, transaction } = pendingData
        const phoneJid = `${user.phone_number}@s.whatsapp.net`
        
        // SUPER SIMPLE CANCELLATION MESSAGE
        const message = `🚫 Payment cancelled\n\nNo money charged.\nTry again: pay ${transaction.naira_amount}`

        await whatsappSocket.sendMessage(phoneJid, { text: message })
        console.log(`🚫 Payment cancelled: ${user.phone_number}`)
    }
}

// SIMPLIFIED REVERSAL MESSAGE
async function handleReversedPayment(data) {
    const { reference } = data
    
    // Find and reverse the transaction (keep existing logic but simplify message)
    const { data: users, error } = await supabase
        .from('users')
        .select('*')
        .not('transactions', 'is', null)

    if (error) return

    for (const user of users) {
        if (user.transactions) {
            const transaction = user.transactions.find(t => 
                t.reference === reference && t.status === 'completed'
            )
            
            if (transaction && whatsappSocket) {
                const phoneJid = `${user.phone_number}@s.whatsapp.net`
                
                // SUPER SIMPLE REVERSAL MESSAGE
                const message = `🔄 Refund processed\n\n-${transaction.tums_amount} coins removed\nRefund: ₦${transaction.naira_amount}\n\nMoney back in 3-5 days`

                await whatsappSocket.sendMessage(phoneJid, { text: message })
                console.log(`🔄 Refund: ${user.phone_number}`)
                break
            }
        }
    }
}

// SIMPLIFIED ERROR REASONS
function getSimpleFailureReason(gatewayResponse) {
    if (!gatewayResponse) return 'Try a different card'
    
    const response = gatewayResponse.toLowerCase()
    
    if (response.includes('insufficient')) return 'Not enough money on card'
    if (response.includes('declined')) return 'Bank declined your card'  
    if (response.includes('expired')) return 'Card expired'
    if (response.includes('invalid')) return 'Wrong card details'
    if (response.includes('restricted')) return 'Card blocked for online payments'
    if (response.includes('limit')) return 'Card limit reached'
    
    return 'Try a different card'
}

module.exports = { 
    handlePaystackWebhook, 
    setWhatsAppSocket
}