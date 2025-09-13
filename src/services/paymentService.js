const https = require('https')
const { supabase } = require('../config/database')
const UserService = require('./userService')

class PaymentService {
    static MINIMUM_AMOUNT = 50000 // Minimum ₦500.00 in kobo
    static CONVERSION_RATE = 4 // 4x tums for every naira paid

    // Create payment link with card payment only
    static async createPaymentLink(email, phoneNumber, amount) {
        // Validate minimum amount
        if (amount < this.MINIMUM_AMOUNT) {
            throw new Error(`Minimum payment amount is ₦${this.MINIMUM_AMOUNT/100}`)
        }

        const reference = `pay_${phoneNumber}_${Date.now()}`
        
        const postData = JSON.stringify({
            email: email,
            amount: amount, // Amount already in kobo
            reference: reference,
            channels: ['card'], // Only allow card payments
            currency: 'NGN',
            metadata: {
                phone_number: phoneNumber,
                payment_method: 'card_only',
                custom_fields: [
                    {
                        display_name: "Phone Number",
                        variable_name: "phone_number",
                        value: phoneNumber
                    },
                    {
                        display_name: "Payment Method",
                        variable_name: "payment_method", 
                        value: "Card Payment"
                    }
                ]
            },
            callback_url: `https://api.whatsapp.com/send?phone=${process.env.BOT_PHONE_NUMBER}&text=Payment completed for reference: ${reference}`
        })

        const options = {
            hostname: 'api.paystack.co',
            port: 443,
            path: '/transaction/initialize',
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        }

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = ''
                res.on('data', (chunk) => data += chunk)
                res.on('end', () => {
                    try {
                        const result = JSON.parse(data)
                        if (result.status) {
                            // Store pending transaction
                            this.storePendingTransaction(phoneNumber, reference, amount)
                            resolve({
                                authorization_url: result.data.authorization_url,
                                reference: reference,
                                amount: amount,
                                access_code: result.data.access_code
                            })
                        } else {
                            reject(new Error(result.message || 'Failed to create payment link'))
                        }
                    } catch (error) {
                        reject(new Error('Invalid response from payment gateway'))
                    }
                })
            })
            
            req.on('error', (error) => {
                reject(new Error(`Payment gateway connection failed: ${error.message}`))
            })
            
            req.setTimeout(30000, () => {
                req.destroy()
                reject(new Error('Payment gateway request timeout'))
            })
            
            req.write(postData)
            req.end()
        })
    }

    // Store pending transaction in user's transaction history
    static async storePendingTransaction(phoneNumber, reference, nairaAmount) {
        try {
            const tumsAmount = nairaAmount * this.CONVERSION_RATE / 100 // Convert kobo to naira, then apply 4x rate
            
            const transaction = {
                id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'credit',
                payment_method: 'card',
                tums_amount: tumsAmount,
                naira_amount: nairaAmount / 100, // Convert kobo to naira for display
                description: `Card payment - ₦${nairaAmount/100}`,
                status: 'pending',
                reference: reference,
                created_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour expiry
            }

            // Add transaction but don't update balance yet (pending)
            const user = await UserService.getUserByPhone(phoneNumber)
            if (user) {
                const currentTransactions = user.transactions || []
                const updatedTransactions = [transaction, ...currentTransactions]

                await supabase
                    .from('users')
                    .update({
                        transactions: updatedTransactions,
                        updated_at: new Date().toISOString()
                    })
                    .eq('phone_number', phoneNumber)
            }

            console.log(`💳 Pending card payment stored: ${reference} - ₦${nairaAmount/100} -> ${tumsAmount} tums`)
        } catch (error) {
            console.error('❌ Error storing pending transaction:', error.message)
        }
    }

    // Complete card payment and credit wallet
    static async completePayment(reference) {
        try {
            // Find user with this payment reference
            const { data: users, error } = await supabase
                .from('users')
                .select('*')
                .not('transactions', 'is', null)

            if (error) throw error

            let targetUser = null
            let pendingTransaction = null

            // Search for the pending transaction
            for (const user of users) {
                if (user.transactions) {
                    const transaction = user.transactions.find(t => 
                        t.reference === reference && t.status === 'pending'
                    )
                    if (transaction) {
                        targetUser = user
                        pendingTransaction = transaction
                        break
                    }
                }
            }

            if (!targetUser || !pendingTransaction) {
                throw new Error('Pending card transaction not found')
            }

            // Update transaction status to completed
            const updatedTransactions = targetUser.transactions.map(t => 
                t.reference === reference ? { 
                    ...t, 
                    status: 'completed',
                    completed_at: new Date().toISOString()
                } : t
            )

            // Update wallet balance
            const newBalance = (targetUser.wallet_balance || 0) + pendingTransaction.tums_amount

            const { data, error: updateError } = await supabase
                .from('users')
                .update({
                    wallet_balance: newBalance,
                    transactions: updatedTransactions,
                    updated_at: new Date().toISOString()
                })
                .eq('phone_number', targetUser.phone_number)
                .select()
                .single()

            if (updateError) throw updateError

            console.log(`✅ Card payment completed: ${reference} - ${pendingTransaction.tums_amount} tums added`)
            return {
                user: data,
                transaction: pendingTransaction,
                newBalance
            }

        } catch (error) {
            console.error('❌ Error completing card payment:', error.message)
            return null
        }
    }

    // Get pending transaction by reference
    static async getPendingTransaction(reference) {
        try {
            const { data: users, error } = await supabase
                .from('users')
                .select('*')
                .not('transactions', 'is', null)

            if (error) throw error

            for (const user of users) {
                if (user.transactions) {
                    const transaction = user.transactions.find(t => 
                        t.reference === reference && t.status === 'pending'
                    )
                    if (transaction) {
                        return { user, transaction }
                    }
                }
            }

            return null
        } catch (error) {
            console.error('❌ Error getting pending transaction:', error.message)
            return null
        }
    }

    // Get any transaction by reference (for cancellations, failures, etc.)
    static async getTransactionByReference(reference) {
        try {
            const { data: users, error } = await supabase
                .from('users')
                .select('*')
                .not('transactions', 'is', null)

            if (error) throw error

            for (const user of users) {
                if (user.transactions) {
                    const transaction = user.transactions.find(t => t.reference === reference)
                    if (transaction) {
                        return { user, transaction }
                    }
                }
            }

            return null
        } catch (error) {
            console.error('❌ Error getting transaction by reference:', error.message)
            return null
        }
    }

    // Update transaction status (for failures, cancellations, etc.)
    static async updateTransactionStatus(phoneNumber, reference, status, additionalData = {}) {
        try {
            const user = await UserService.getUserByPhone(phoneNumber)
            if (!user || !user.transactions) return false

            const updatedTransactions = user.transactions.map(t => 
                t.reference === reference ? { 
                    ...t, 
                    status: status,
                    ...additionalData,
                    updated_at: new Date().toISOString()
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
            return true
        } catch (error) {
            console.error('❌ Error updating transaction status:', error.message)
            return false
        }
    }

    // Cancel pending transaction
    static async cancelTransaction(reference, reason = 'Payment cancelled') {
        try {
            const transactionData = await this.getTransactionByReference(reference)
            if (!transactionData) return null

            const { user, transaction } = transactionData
            
            if (transaction.status !== 'pending') {
                console.log(`⚠️ Cannot cancel non-pending transaction: ${reference} (Status: ${transaction.status})`)
                return null
            }

            const success = await this.updateTransactionStatus(user.phone_number, reference, 'cancelled', {
                cancelled_reason: reason,
                cancelled_at: new Date().toISOString()
            })

            if (success) {
                console.log(`🚫 Transaction cancelled: ${reference}`)
                return { user, transaction }
            }
            
            return null
        } catch (error) {
            console.error('❌ Error cancelling transaction:', error.message)
            return null
        }
    }

    // Mark transaction as failed
    static async failTransaction(reference, reason = 'Payment failed') {
        try {
            const transactionData = await this.getTransactionByReference(reference)
            if (!transactionData) return null

            const { user, transaction } = transactionData
            
            const success = await this.updateTransactionStatus(user.phone_number, reference, 'failed', {
                failure_reason: reason,
                failed_at: new Date().toISOString()
            })

            if (success) {
                console.log(`❌ Transaction failed: ${reference}`)
                return { user, transaction }
            }
            
            return null
        } catch (error) {
            console.error('❌ Error failing transaction:', error.message)
            return null
        }
    }

    // Get expired pending transactions
    static async getExpiredTransactions() {
        try {
            const { data: users, error } = await supabase
                .from('users')
                .select('*')
                .not('transactions', 'is', null)

            if (error) throw error

            const expiredTransactions = []
            const now = new Date()

            for (const user of users) {
                if (user.transactions) {
                    user.transactions.forEach(transaction => {
                        if (transaction.status === 'pending' && 
                            transaction.expires_at && 
                            new Date(transaction.expires_at) < now) {
                            expiredTransactions.push({ user, transaction })
                        }
                    })
                }
            }

            return expiredTransactions
        } catch (error) {
            console.error('❌ Error getting expired transactions:', error.message)
            return []
        }
    }

    // Clean up expired transactions
    static async cleanupExpiredTransactions() {
        try {
            const expiredTransactions = await this.getExpiredTransactions()
            let cleanedCount = 0

            for (const { user, transaction } of expiredTransactions) {
                const success = await this.updateTransactionStatus(
                    user.phone_number, 
                    transaction.reference, 
                    'expired', 
                    {
                        expired_reason: 'Payment session timeout',
                        expired_at: new Date().toISOString()
                    }
                )

                if (success) {
                    cleanedCount++
                    console.log(`⏰ Transaction expired: ${transaction.reference}`)
                }
            }

            if (cleanedCount > 0) {
                console.log(`🧹 Cleaned up ${cleanedCount} expired transactions`)
            }

            return cleanedCount
        } catch (error) {
            console.error('❌ Error cleaning up expired transactions:', error.message)
            return 0
        }
    }

    // Parse amount from user input
    static parseAmount(input) {
        // Remove any non-numeric characters except decimal point
        const cleanInput = input.replace(/[^\d.]/g, '')
        const amount = parseFloat(cleanInput)
        
        if (isNaN(amount) || amount <= 0) {
            throw new Error('Please enter a valid amount (numbers only)')
        }

        // Convert to kobo
        const amountInKobo = Math.round(amount * 100)

        if (amountInKobo < this.MINIMUM_AMOUNT) {
            throw new Error(`Minimum card payment amount is ₦${this.MINIMUM_AMOUNT/100}`)
        }

        return amountInKobo
    }

    // Calculate tums that will be received
    static calculateCoins(nairaAmount) {
        return nairaAmount * this.CONVERSION_RATE / 100 // Convert kobo to naira, then apply 4x
    }

    // Verify card payment with Paystack
    static async verifyPayment(reference) {
        const options = {
            hostname: 'api.paystack.co',
            port: 443,
            path: `/transaction/verify/${reference}`,
            method: 'GET',
            headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
            }
        }

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = ''
                res.on('data', (chunk) => data += chunk)
                res.on('end', () => {
                    try {
                        const result = JSON.parse(data)
                        resolve(result)
                    } catch (error) {
                        reject(new Error('Invalid payment verification response'))
                    }
                })
            })
            
            req.on('error', (error) => {
                reject(new Error(`Payment verification failed: ${error.message}`))
            })
            
            req.setTimeout(15000, () => {
                req.destroy()
                reject(new Error('Payment verification timeout'))
            })
            
            req.end()
        })
    }

    // Get user transaction history with filters
    static async getUserTransactions(phoneNumber, status = null, limit = 10) {
        try {
            const user = await UserService.getUserByPhone(phoneNumber)
            if (!user || !user.transactions) return []

            let transactions = user.transactions

            // Filter by status if provided
            if (status) {
                transactions = transactions.filter(t => t.status === status)
            }

            // Sort by creation date (newest first) and limit
            return transactions
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .slice(0, limit)

        } catch (error) {
            console.error('❌ Error getting user transactions:', error.message)
            return []
        }
    }

    // Get transaction statistics
    static async getTransactionStats(phoneNumber = null) {
        try {
            let users = []
            
            if (phoneNumber) {
                const user = await UserService.getUserByPhone(phoneNumber)
                if (user) users = [user]
            } else {
                const { data, error } = await supabase
                    .from('users')
                    .select('*')
                    .not('transactions', 'is', null)
                
                if (error) throw error
                users = data
            }

            const stats = {
                total: 0,
                completed: 0,
                pending: 0,
                failed: 0,
                cancelled: 0,
                expired: 0,
                reversed: 0,
                totalAmount: 0,
                totalTums: 0,
                averageAmount: 0
            }

            let completedTransactions = []

            users.forEach(user => {
                if (user.transactions) {
                    user.transactions.forEach(transaction => {
                        if (transaction.payment_method === 'card') {
                            stats.total++
                            stats[transaction.status] = (stats[transaction.status] || 0) + 1
                            
                            if (transaction.status === 'completed') {
                                stats.totalAmount += transaction.naira_amount
                                stats.totalTums += transaction.tums_amount
                                completedTransactions.push(transaction)
                            }
                        }
                    })
                }
            })

            if (completedTransactions.length > 0) {
                stats.averageAmount = stats.totalAmount / completedTransactions.length
            }

            return stats
        } catch (error) {
            console.error('❌ Error getting transaction stats:', error.message)
            return null
        }
    }

    // Get supported payment methods (only card)
    static getSupportedPaymentMethods() {
        return {
            card: {
                name: 'Credit/Debit Card',
                description: 'Visa, Mastercard, Verve cards',
                min_amount: this.MINIMUM_AMOUNT / 100,
                conversion_rate: this.CONVERSION_RATE,
                fees: 'Standard card processing fees apply'
            }
        }
    }

    // Validate card payment requirements
    static validateCardPayment(amount) {
        const errors = []
        
        if (amount < this.MINIMUM_AMOUNT) {
            errors.push(`Minimum card payment is ₦${this.MINIMUM_AMOUNT/100}`)
        }
        
        if (amount > 500000000) { // 5 million naira limit
            errors.push('Maximum card payment is ₦5,000,000')
        }
        
        return {
            isValid: errors.length === 0,
            errors
        }
    }

    // Format amount for display
    static formatAmount(amount, currency = '₦') {
        return `${currency}${amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }

    // Format tums for display
    static formatTums(tums) {
        return `${tums.toLocaleString('en-NG')} tums`
    }

    // Get payment status emoji
    static getStatusEmoji(status) {
        const emojis = {
            pending: '⏳',
            completed: '✅',
            failed: '❌',
            cancelled: '🚫',
            expired: '⏰',
            reversed: '🔄',
            disputed: '⚠️'
        }
        return emojis[status] || '❓'
    }

    // Check if reference is valid format
    static isValidReference(reference) {
        return /^pay_\d+_\d+$/.test(reference)
    }
}

module.exports = PaymentService