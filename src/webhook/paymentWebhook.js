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
        console.log(`📡 Webhook received: ${event.event} - Reference: ${event.data?.reference}`)

        // Handle successful card payments
        if (event.event === 'charge.success') {
            await handleSuccessfulPayment(event.data)
        }
        
        // Handle failed card payments (technical failures, insufficient funds, etc.)
        else if (event.event === 'charge.failed') {
            await handleFailedPayment(event.data)
        }
        
        // Handle payment cancellations (user abandoned payment)
        else if (event.event === 'charge.cancelled' || 
                 event.event === 'charge.abandoned' || 
                 event.event === 'invoice.payment_failed') {
            await handleCancelledPayment(event.data)
        }
        
        // Handle payment reversals/refunds
        else if (event.event === 'charge.reversed' || 
                 event.event === 'refund.processed') {
            await handleReversedPayment(event.data)
        }
        
        // Handle payment disputes
        else if (event.event === 'charge.dispute') {
            await handleDisputedPayment(event.data)
        }
        
        // Handle pending payments (authorization captured but not settled)
        else if (event.event === 'charge.pending') {
            await handlePendingPayment(event.data)
        }
        
        // Handle authorization events (card authorized but not charged yet)
        else if (event.event === 'authorization.success') {
            console.log(`🔐 Card authorization successful: ${event.data.reference}`)
            // Don't credit wallet yet, wait for charge.success
        }
        
        // Handle authorization failures
        else if (event.event === 'authorization.failed') {
            await handleAuthorizationFailed(event.data)
        }
        
        // Handle transfer events (not applicable for card payments, but log them)
        else if (event.event === 'transfer.success' || 
                 event.event === 'transfer.failed' || 
                 event.event === 'transfer.reversed') {
            console.log(`ℹ️ Transfer event received but ignored (card payments only): ${event.event} - ${event.data.reference}`)
        }
        
        // Handle invoice events
        else if (event.event === 'invoice.create' || 
                 event.event === 'invoice.update') {
            console.log(`📋 Invoice event: ${event.event} - ${event.data.reference}`)
        }
        
        // Handle subscription events (if you add subscriptions later)
        else if (event.event.startsWith('subscription.')) {
            console.log(`🔄 Subscription event: ${event.event}`)
        }
        
        // Handle customer events
        else if (event.event.startsWith('customer.')) {
            console.log(`👤 Customer event: ${event.event}`)
        }
        
        // Catch any other events
        else {
            console.log(`⚠️ Unhandled webhook event: ${event.event}`)
            console.log(`📄 Event data:`, JSON.stringify(event.data, null, 2))
        }

        res.status(200).send('OK')
    } catch (error) {
        console.error('❌ Webhook error:', error.message)
        console.error('🔍 Error stack:', error.stack)
        res.status(500).send('Webhook error')
    }
}

// Handle successful card payments
async function handleSuccessfulPayment(data) {
    const { reference, status, amount, channel, authorization, customer } = data
    
    console.log(`💳 Card payment success: ${reference} - ${status} - ₦${amount/100} via ${channel}`)
    
    // Only process card payments
    if (channel !== 'card') {
        console.log(`⚠️ Non-card payment success: ${channel} - Reference: ${reference}`)
        return
    }

    const result = await PaymentService.completePayment(reference)
    
    if (result && whatsappSocket) {
        const { user, transaction, newBalance } = result
        
        const cardInfo = authorization ? {
            last4: authorization.last4 || '****',
            cardType: authorization.card_type || 'Card',
            bank: authorization.bank || 'Bank'
        } : { last4: '****', cardType: 'Card', bank: 'Bank' }
        
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

// Handle failed card payments
async function handleFailedPayment(data) {
    const { reference, status, channel, gateway_response, authorization } = data
    
    console.log(`❌ Card payment failed: ${reference} - ${status} - ${gateway_response}`)

    const pendingData = await PaymentService.getPendingTransaction(reference)
    
    if (pendingData && whatsappSocket) {
        const { user, transaction } = pendingData
        
        // Update transaction status to failed
        await updateTransactionStatus(user.phone_number, reference, 'failed', {
            failure_reason: gateway_response || 'Card payment failed',
            failed_at: new Date().toISOString()
        })

        const failureReason = getDetailedFailureMessage(gateway_response, authorization)
        const phoneJid = `${user.phone_number}@s.whatsapp.net`
        
        const message = `❌ *Card Payment Failed*

${failureReason}

🔐 Reference: ${reference}
💰 Amount: ₦${transaction.naira_amount}
📅 ${new Date().toLocaleString()}

💡 *What you can do:*
• Check your card balance and limits
• Ensure your card is enabled for online payments
• Contact your bank to authorize the transaction
• Try a different card (Visa, Mastercard, Verve)

*Try again with:*
/pay ${transaction.naira_amount} - Same amount
/pay 500 - Minimum amount
🏦 /balance - Check current wallet

_No money was deducted from your account_`

        await whatsappSocket.sendMessage(phoneJid, { text: message })
        console.log(`❌ Card payment failure notification sent: ${user.phone_number} - ${failureReason}`)
    }
}

// Handle cancelled/abandoned payments
async function handleCancelledPayment(data) {
    const { reference, status, channel } = data
    
    console.log(`🚫 Payment cancelled/abandoned: ${reference} - ${status}`)

    const pendingData = await PaymentService.getPendingTransaction(reference)
    
    if (pendingData && whatsappSocket) {
        const { user, transaction } = pendingData
        
        // Update transaction status to cancelled
        await updateTransactionStatus(user.phone_number, reference, 'cancelled', {
            cancelled_reason: 'Payment abandoned by user',
            cancelled_at: new Date().toISOString()
        })

        const phoneJid = `${user.phone_number}@s.whatsapp.net`
        const message = `🚫 *Payment Cancelled*

Your card payment was cancelled or abandoned.

💳 Amount: ₦${transaction.naira_amount}
🔐 Reference: ${reference}
📅 ${new Date().toLocaleString()}

*No money was charged to your card.*

*Want to try again?*
/pay ${transaction.naira_amount} - Same amount
/pay 500 - Start with minimum
🏦 /balance - Check current balance

*Need help?*
Make sure you complete the payment within the time limit and don't close the payment page.`

        await whatsappSocket.sendMessage(phoneJid, { text: message })
        console.log(`🚫 Payment cancellation notification sent: ${user.phone_number}`)
    }
}

// Handle reversed/refunded payments
async function handleReversedPayment(data) {
    const { reference, amount, status } = data
    
    console.log(`🔄 Payment reversed/refunded: ${reference} - ₦${amount/100}`)

    // Find completed transaction and reverse it
    const { data: users, error } = await supabase
        .from('users')
        .select('*')
        .not('transactions', 'is', null)

    if (error) {
        console.error('❌ Error finding users for reversal:', error.message)
        return
    }

    for (const user of users) {
        if (user.transactions) {
            const transaction = user.transactions.find(t => 
                t.reference === reference && t.status === 'completed'
            )
            
            if (transaction && whatsappSocket) {
                // Deduct the tums from user's balance
                const newBalance = Math.max(0, (user.wallet_balance || 0) - transaction.tums_amount)
                
                // Create reversal transaction
                const reversalTransaction = {
                    id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    type: 'debit',
                    payment_method: 'card_reversal',
                    tums_amount: transaction.tums_amount,
                    naira_amount: transaction.naira_amount,
                    description: `Card payment reversal - ${reference}`,
                    status: 'completed',
                    reference: `rev_${reference}`,
                    created_at: new Date().toISOString()
                }

                // Update original transaction status
                const updatedTransactions = user.transactions.map(t => 
                    t.reference === reference ? { 
                        ...t, 
                        status: 'reversed',
                        reversed_at: new Date().toISOString()
                    } : t
                )
                
                // Add reversal transaction
                updatedTransactions.unshift(reversalTransaction)

                await supabase
                    .from('users')
                    .update({
                        wallet_balance: newBalance,
                        transactions: updatedTransactions,
                        updated_at: new Date().toISOString()
                    })
                    .eq('phone_number', user.phone_number)

                const phoneJid = `${user.phone_number}@s.whatsapp.net`
                const message = `🔄 *Payment Reversed*

Your card payment has been reversed/refunded.

💰 Amount Refunded: ₦${transaction.naira_amount}
🪙 Tums Deducted: ${transaction.tums_amount} tums
🏦 New Balance: *${newBalance} tums*
🔐 Original Reference: ${reference}
📅 ${new Date().toLocaleString()}

*The refund will appear on your card statement in 3-5 business days.*

*Need to add money again?*
💳 /pay [amount] - Add via card
🏦 /balance - Check balance`

                await whatsappSocket.sendMessage(phoneJid, { text: message })
                console.log(`🔄 Payment reversal notification sent: ${user.phone_number}`)
                break
            }
        }
    }
}

// Handle disputed payments
async function handleDisputedPayment(data) {
    const { reference, status, dispute_reason } = data
    console.log(`⚠️ Card payment dispute: ${reference} - ${status} - ${dispute_reason}`)

    const pendingData = await PaymentService.getPendingTransaction(reference)
    
    if (pendingData && whatsappSocket) {
        const { user } = pendingData
        const phoneJid = `${user.phone_number}@s.whatsapp.net`
        const message = `⚠️ *Payment Dispute Notice*

A dispute has been raised for your card payment.

🔐 Reference: ${reference}
📋 Reason: ${dispute_reason || 'Dispute reported'}
📅 ${new Date().toLocaleString()}

*What happens next:*
• We will investigate this dispute
• Your account remains active
• No immediate action needed from you

📞 *Need Help?*
Contact our support team for assistance.

_We will resolve this matter promptly_`

        await whatsappSocket.sendMessage(phoneJid, { text: message })
        console.log(`⚠️ Dispute notification sent: ${user.phone_number}`)
    }
}

// Handle pending payments (authorized but not yet settled)
async function handlePendingPayment(data) {
    const { reference, status } = data
    console.log(`⏳ Payment pending settlement: ${reference} - ${status}`)

    const pendingData = await PaymentService.getPendingTransaction(reference)
    
    if (pendingData && whatsappSocket) {
        const { user, transaction } = pendingData
        const phoneJid = `${user.phone_number}@s.whatsapp.net`
        
        const message = `⏳ *Payment Processing*

Your card payment is being processed.

💳 Amount: ₦${transaction.naira_amount}
🪙 Tums to receive: ${transaction.tums_amount} tums
🔐 Reference: ${reference}

*This usually takes a few minutes.*
You'll get another message when it's completed.

_Please don't make another payment for the same amount_`

        await whatsappSocket.sendMessage(phoneJid, { text: message })
        console.log(`⏳ Pending payment notification sent: ${user.phone_number}`)
    }
}

// Handle authorization failures (card declined before charging)
async function handleAuthorizationFailed(data) {
    const { reference, gateway_response, authorization } = data
    console.log(`🚫 Card authorization failed: ${reference} - ${gateway_response}`)

    const pendingData = await PaymentService.getPendingTransaction(reference)
    
    if (pendingData && whatsappSocket) {
        const { user, transaction } = pendingData
        
        // Update transaction status to failed
        await updateTransactionStatus(user.phone_number, reference, 'failed', {
            failure_reason: `Authorization failed: ${gateway_response}`,
            failed_at: new Date().toISOString()
        })

        const failureReason = getAuthorizationFailureMessage(gateway_response)
        const phoneJid = `${user.phone_number}@s.whatsapp.net`
        
        const message = `🚫 *Card Authorization Failed*

${failureReason}

💳 Amount: ₦${transaction.naira_amount}
🔐 Reference: ${reference}
📅 ${new Date().toLocaleString()}

*Common solutions:*
• Contact your bank to enable online payments
• Check if your card has international restrictions
• Verify your card details are correct
• Try a different card

*Try again:*
/pay ${transaction.naira_amount}

_No money was charged to your card_`

        await whatsappSocket.sendMessage(phoneJid, { text: message })
        console.log(`🚫 Authorization failure notification sent: ${user.phone_number}`)
    }
}

// Helper function to update transaction status
async function updateTransactionStatus(phoneNumber, reference, status, additionalData = {}) {
    try {
        const user = await PaymentService.getPendingTransaction(reference)
        if (!user) return

        const updatedTransactions = user.user.transactions.map(t => 
            t.reference === reference ? { 
                ...t, 
                status: status,
                ...additionalData
            } : t
        )

        await supabase
            .from('users')
            .update({
                transactions: updatedTransactions,
                updated_at: new Date().toISOString()
            })
            .eq('phone_number', phoneNumber)

        console.log(`📝 Transaction status updated: ${reference} -> ${status}`)
    } catch (error) {
        console.error('❌ Error updating transaction status:', error.message)
    }
}

// Enhanced failure message generator
function getDetailedFailureMessage(gatewayResponse, authorization) {
    if (!gatewayResponse) return 'Card payment could not be processed'
    
    const response = gatewayResponse.toLowerCase()
    
    // Insufficient funds
    if (response.includes('insufficient') || response.includes('balance')) {
        return '💳 Insufficient funds on your card'
    }
    
    // Card declined by bank
    if (response.includes('declined') || response.includes('denied')) {
        return '🚫 Your card was declined by the bank'
    }
    
    // Expired card
    if (response.includes('expired') || response.includes('expiry')) {
        return '📅 Your card has expired'
    }
    
    // Invalid card details
    if (response.includes('invalid') || response.includes('incorrect')) {
        return '❌ Invalid card details provided'
    }
    
    // Card not enabled for online payments
    if (response.includes('restricted') || response.includes('blocked')) {
        return '🔒 Your card is restricted for online payments'
    }
    
    // CVV/PIN issues
    if (response.includes('cvv') || response.includes('pin')) {
        return '🔢 Incorrect card security details (CVV/PIN)'
    }
    
    // Network/connection issues
    if (response.includes('network') || response.includes('timeout')) {
        return '📡 Network connection issue. Please try again'
    }
    
    // Card limit exceeded
    if (response.includes('limit') || response.includes('exceed')) {
        return '📈 Card transaction limit exceeded'
    }
    
    // Generic bank issues
    if (response.includes('issuer') || response.includes('bank')) {
        return '🏦 Issue with your card issuer. Contact your bank'
    }
    
    return `💳 Card payment failed: ${gatewayResponse}`
}

// Authorization failure message generator
function getAuthorizationFailureMessage(gatewayResponse) {
    if (!gatewayResponse) return 'Card authorization failed'
    
    const response = gatewayResponse.toLowerCase()
    
    if (response.includes('restricted') || response.includes('blocked')) {
        return '🔒 Your card is blocked for online transactions'
    }
    
    if (response.includes('international')) {
        return '🌍 Your card doesn\'t support international transactions'
    }
    
    if (response.includes('merchant')) {
        return '🏪 Your card doesn\'t support payments to this merchant'
    }
    
    return `🚫 Authorization failed: ${gatewayResponse}`
}

// Add cleanup function for abandoned payments (run periodically)
async function cleanupAbandonedPayments() {
    try {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
        
        const { data: users, error } = await supabase
            .from('users')
            .select('*')
            .not('transactions', 'is', null)

        if (error) throw error

        for (const user of users) {
            if (user.transactions) {
                let hasUpdates = false
                const updatedTransactions = user.transactions.map(t => {
                    if (t.status === 'pending' && t.created_at < oneHourAgo) {
                        hasUpdates = true
                        return {
                            ...t,
                            status: 'abandoned',
                            abandoned_reason: 'Payment session expired',
                            abandoned_at: new Date().toISOString()
                        }
                    }
                    return t
                })

                if (hasUpdates) {
                    await supabase
                        .from('users')
                        .update({
                            transactions: updatedTransactions,
                            updated_at: new Date().toISOString()
                        })
                        .eq('phone_number', user.phone_number)

                    console.log(`🧹 Cleaned up abandoned payments for: ${user.phone_number}`)
                }
            }
        }
    } catch (error) {
        console.error('❌ Error cleaning up abandoned payments:', error.message)
    }
}

// Run cleanup every 30 minutes
setInterval(cleanupAbandonedPayments, 30 * 60 * 1000)

module.exports = { 
    handlePaystackWebhook, 
    setWhatsAppSocket,
    cleanupAbandonedPayments
}