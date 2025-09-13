const crypto = require('crypto')
const PaymentService = require('../services/paymentService')
const { supabase } = require('../config/database')

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
            const { 
                reference, 
                status, 
                amount, 
                channel, 
                authorization,
                customer 
            } = event.data
            
            console.log(`💳 Card payment webhook: ${reference} - ${status} - ₦${amount/100} via ${channel}`)
            
            // Verify it's a card payment
            if (channel !== 'card') {
                console.log(`⚠️ Non-card payment received: ${channel} - Reference: ${reference}`)
                return res.status(200).send('Only card payments accepted')
            }

            // Complete the card payment and credit wallet
            const result = await PaymentService.completePayment(reference)
            
            if (result && whatsappSocket) {
                const { user, transaction, newBalance } = result
                
                // Get card details if available
                const cardInfo = authorization ? {
                    last4: authorization.last4 || '****',
                    cardType: authorization.card_type || 'Card',
                    bank: authorization.bank || 'Bank'
                } : { last4: '****', cardType: 'Card', bank: 'Bank' }
                
                // Send comprehensive confirmation message to user
                const phoneJid = `${user.phone_number}@s.whatsapp.net`
                const message = `🎉 *Card Payment Successful!*

✅ *Wallet Credited Successfully*
💳 Payment Method: ${cardInfo.cardType} (**** ${cardInfo.last4})
🏦 Bank: ${cardInfo.bank}
💰 Amount Paid: ₦${transaction.naira_amount}
🪙 Tums Added: *${transaction.tums_amount} tums*
🏦 New Balance: *${newBalance} tums*

🔐 Reference: ${reference}
👤 Name: ${user.display_name}
📅 ${new Date().toLocaleString()}

_Thank you for your card payment! Your tums are now available._

*Available Commands:*
🏦 /balance - Check balance
💳 /pay [amount] - Add more via card

*Quick Top-ups:*
/pay 1000 → 4000 tums
/pay 2500 → 10000 tums`

                await whatsappSocket.sendMessage(phoneJid, { text: message })
                console.log(`✅ Card payment completed: ${user.phone_number} - ${transaction.tums_amount} tums via ${cardInfo.cardType}`)
            } else {
                console.log(`⚠️ Card payment completed but no user found or WhatsApp not connected: ${reference}`)
            }
        }

        else if (event.event === 'charge.failed') {
            const { 
                reference, 
                status, 
                channel,
                gateway_response 
            } = event.data
            
            console.log(`❌ Card payment failed: ${reference} - ${status} - ${gateway_response}`)

            // Find and update the failed transaction
            const pendingData = await PaymentService.getPendingTransaction(reference)
            
            if (pendingData && whatsappSocket) {
                const { user, transaction } = pendingData
                
                // Update transaction status to failed
                const updatedTransactions = user.transactions.map(t => 
                    t.reference === reference ? { 
                        ...t, 
                        status: 'failed',
                        failure_reason: gateway_response || 'Card payment failed',
                        failed_at: new Date().toISOString()
                    } : t
                )

                // Update database with failed status
                await supabase
                    .from('users')
                    .update({
                        transactions: updatedTransactions,
                        updated_at: new Date().toISOString()
                    })
                    .eq('phone_number', user.phone_number)

                // Determine failure reason for user-friendly message
                const getFailureMessage = (response) => {
                    const msg = (response || '').toLowerCase()
                    if (msg.includes('insufficient')) return 'Insufficient funds on card'
                    if (msg.includes('declined')) return 'Card declined by bank'
                    if (msg.includes('expired')) return 'Card has expired'
                    if (msg.includes('invalid')) return 'Invalid card details'
                    return 'Card payment could not be processed'
                }

                const failureReason = getFailureMessage(gateway_response)

                // Notify user of failed card payment
                const phoneJid = `${user.phone_number}@s.whatsapp.net`
                const message = `❌ *Card Payment Failed*

💳 ${failureReason}

🔐 Reference: ${reference}
💰 Amount: ₦${transaction.naira_amount}
📅 ${new Date().toLocaleString()}

💡 *What you can do:*
• Check your card balance and try again
• Ensure your card is enabled for online payments
• Try a different card (Visa, Mastercard, Verve)
• Contact your bank if issue persists

*Try again with:*
/pay ${transaction.naira_amount} - Same amount
/pay 500 - Minimum amount
🏦 /balance - Check current wallet

_No money was deducted from your account_`

                await whatsappSocket.sendMessage(phoneJid, { text: message })
                console.log(`❌ Card payment failure notification sent: ${user.phone_number} - ${failureReason}`)
            }
        }

        else if (event.event === 'charge.dispute') {
            const { reference, status } = event.data
            console.log(`⚠️ Card payment dispute: ${reference} - ${status}`)

            // Handle dispute - could implement dispute tracking here
            const pendingData = await PaymentService.getPendingTransaction(reference)
            
            if (pendingData && whatsappSocket) {
                const { user } = pendingData
                const phoneJid = `${user.phone_number}@s.whatsapp.net`
                const message = `⚠️ *Payment Dispute Notice*

A dispute has been raised for your card payment.

🔐 Reference: ${reference}
📞 For assistance, please contact our support team.

_We will resolve this matter promptly_`

                await whatsappSocket.sendMessage(phoneJid, { text: message })
                console.log(`⚠️ Dispute notification sent: ${user.phone_number}`)
            }
        }

        else if (event.event === 'transfer.success') {
            // Log but don't process - we only handle card payments
            console.log(`ℹ️ Transfer event received but ignored (card payments only): ${event.data.reference}`)
        }

        else {
            console.log(`ℹ️ Unhandled webhook event: ${event.event}`)
        }

        res.status(200).send('OK')
    } catch (error) {
        console.error('❌ Webhook error:', error.message)
        res.status(500).send('Webhook error')
    }
}

// Verify card payment status manually (for debugging)
async function verifyCardPayment(reference) {
    try {
        const verification = await PaymentService.verifyPayment(reference)
        
        if (verification.status && verification.data.status === 'success') {
            if (verification.data.channel === 'card') {
                console.log(`✅ Card payment verified: ${reference}`)
                return await PaymentService.completePayment(reference)
            } else {
                console.log(`❌ Non-card payment verified: ${verification.data.channel}`)
                return null
            }
        } else {
            console.log(`❌ Payment verification failed: ${reference}`)
            return null
        }
    } catch (error) {
        console.error('❌ Payment verification error:', error.message)
        return null
    }
}

// Get card payment statistics
async function getCardPaymentStats() {
    try {
        const { data: users, error } = await supabase
            .from('users')
            .select('transactions')
            .not('transactions', 'is', null)

        if (error) throw error

        const stats = {
            totalTransactions: 0,
            completedPayments: 0,
            failedPayments: 0,
            pendingPayments: 0,
            totalAmount: 0,
            totalTums: 0
        }

        users.forEach(user => {
            if (user.transactions) {
                user.transactions.forEach(transaction => {
                    if (transaction.payment_method === 'card') {
                        stats.totalTransactions++
                        
                        if (transaction.status === 'completed') {
                            stats.completedPayments++
                            stats.totalAmount += transaction.naira_amount
                            stats.totalTums += transaction.tums_amount
                        } else if (transaction.status === 'failed') {
                            stats.failedPayments++
                        } else if (transaction.status === 'pending') {
                            stats.pendingPayments++
                        }
                    }
                })
            }
        })

        return stats
    } catch (error) {
        console.error('❌ Error getting card payment stats:', error.message)
        return null
    }
}

module.exports = { 
    handlePaystackWebhook, 
    setWhatsAppSocket, 
    verifyCardPayment,
    getCardPaymentStats 
}