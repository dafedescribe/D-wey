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
                created_at: new Date().toISOString()
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
}

module.exports = PaymentService