const https = require('https')
const { supabase } = require('../config/database')
const UserService = require('./userService')

class PaymentService {
    static MINIMUM_AMOUNT = 500 // Minimum ₦5.00
    static CONVERSION_RATE = 4 // 4x coins for every naira paid

    // Create payment link with custom amount
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
            callback_url: `https://api.whatsapp.com/send?phone=${process.env.BOT_PHONE_NUMBER}`
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
                                amount: amount
                            })
                        } else {
                            reject(new Error(result.message))
                        }
                    } catch (error) {
                        reject(error)
                    }
                })
            })
            
            req.on('error', reject)
            req.write(postData)
            req.end()
        })
    }

    // Store pending transaction in user's transaction history
    static async storePendingTransaction(phoneNumber, reference, nairaAmount) {
        try {
            const coinsAmount = nairaAmount * this.CONVERSION_RATE / 100 // Convert kobo to naira, then apply 4x rate
            
            const transaction = {
                id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'credit',
                coins_amount: coinsAmount,
                naira_amount: nairaAmount / 100, // Convert kobo to naira for display
                description: `Wallet top-up - ₦${nairaAmount/100}`,
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

            console.log(`💰 Pending transaction stored: ${reference} - ₦${nairaAmount/100} -> ${coinsAmount} coins`)
        } catch (error) {
            console.error('❌ Error storing pending transaction:', error.message)
        }
    }

    // Complete payment and credit wallet
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
                throw new Error('Pending transaction not found')
            }

            // Update transaction status to completed
            const updatedTransactions = targetUser.transactions.map(t => 
                t.reference === reference ? { ...t, status: 'completed' } : t
            )

            // Update wallet balance
            const newBalance = (targetUser.wallet_balance || 0) + pendingTransaction.coins_amount

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

            console.log(`✅ Payment completed: ${reference} - ${pendingTransaction.coins_amount} coins added`)
            return {
                user: data,
                transaction: pendingTransaction,
                newBalance
            }

        } catch (error) {
            console.error('❌ Error completing payment:', error.message)
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
            throw new Error('Invalid amount format')
        }

        // Convert to kobo
        const amountInKobo = Math.round(amount * 100)

        if (amountInKobo < this.MINIMUM_AMOUNT) {
            throw new Error(`Minimum amount is ₦${this.MINIMUM_AMOUNT/100}`)
        }

        return amountInKobo
    }

    // Calculate coins that will be received
    static calculateCoins(nairaAmount) {
        return nairaAmount * this.CONVERSION_RATE / 100 // Convert kobo to naira, then apply 4x
    }

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
                        reject(error)
                    }
                })
            })
            
            req.on('error', reject)
            req.end()
        })
    }
}

module.exports = PaymentService