const { supabase } = require('../config/database')

class UserService {
    // Rate limiting storage (in-memory for simplicity)
    static rateLimitStorage = new Map()
    static RATE_LIMIT_WINDOW = 60000 // 1 minute
    static MAX_REQUESTS_PER_MINUTE = 5 // 5 requests per minute
    static SIGNUP_BONUS = 1000 // 1000 tums bonus for new users

    // Rate limiting check
    static checkRateLimit(phoneNumber, action = 'general') {
        const key = `${phoneNumber}_${action}`
        const now = Date.now()
        
        if (!this.rateLimitStorage.has(key)) {
            this.rateLimitStorage.set(key, { count: 1, resetTime: now + this.RATE_LIMIT_WINDOW })
            return { allowed: true, remaining: this.MAX_REQUESTS_PER_MINUTE - 1 }
        }
        
        const data = this.rateLimitStorage.get(key)
        
        // Reset if window expired
        if (now > data.resetTime) {
            this.rateLimitStorage.set(key, { count: 1, resetTime: now + this.RATE_LIMIT_WINDOW })
            return { allowed: true, remaining: this.MAX_REQUESTS_PER_MINUTE - 1 }
        }
        
        // Check if limit exceeded
        if (data.count >= this.MAX_REQUESTS_PER_MINUTE) {
            const resetIn = Math.ceil((data.resetTime - now) / 1000)
            return { 
                allowed: false, 
                remaining: 0, 
                resetIn,
                message: `⚠️ Rate limit exceeded. Please wait ${resetIn} seconds before trying again.`
            }
        }
        
        // Increment count
        data.count++
        return { allowed: true, remaining: this.MAX_REQUESTS_PER_MINUTE - data.count }
    }

    // Clean up old rate limit entries (run periodically)
    static cleanupRateLimit() {
        const now = Date.now()
        for (const [key, data] of this.rateLimitStorage.entries()) {
            if (now > data.resetTime) {
                this.rateLimitStorage.delete(key)
            }
        }
    }

    // Validate email format
    static isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        return emailRegex.test(email)
    }

    // Check if user exists
    static async getUserByPhone(phoneNumber) {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('phone_number', phoneNumber)
                .single()

            if (error && error.code !== 'PGRST116') throw error
            return data
        } catch (error) {
            console.error('❌ Error getting user:', error.message)
            return null
        }
    }

    // Store user email and initialize wallet (only for new users)
    static async storeUserEmail(phoneNumber, displayName, email) {
        try {
            // Validate email
            if (!this.isValidEmail(email)) {
                throw new Error('Invalid email format')
            }

            // Check if user already exists
            const existingUser = await this.getUserByPhone(phoneNumber)

            if (existingUser) {
                // User exists - don't allow email changes
                if (existingUser.email && existingUser.email !== email) {
                    throw new Error(`❌ Email cannot be changed. Your registered email is: ${existingUser.email}`)
                }
                
                // If they send the same email, just return existing user info
                if (existingUser.email === email) {
                    return { user: existingUser, isNew: false, message: 'Email already registered' }
                }
                
                // This shouldn't happen but handle gracefully
                console.log(`⚠️ User exists but no email set for: ${phoneNumber}`)
                return { user: existingUser, isNew: false, message: 'User exists' }
            } else {
                // Create new user with signup bonus
                const signupTransaction = {
                    id: `txn_signup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    type: 'credit',
                    payment_method: 'signup_bonus',
                    tums_amount: this.SIGNUP_BONUS,
                    naira_amount: 0,
                    description: `Welcome bonus - ${this.SIGNUP_BONUS} tums`,
                    status: 'completed',
                    reference: null,
                    created_at: new Date().toISOString()
                }

                const { data, error } = await supabase
                    .from('users')
                    .insert([{
                        phone_number: phoneNumber,
                        display_name: displayName,
                        email: email,
                        wallet_balance: this.SIGNUP_BONUS, // Start with signup bonus
                        transactions: [signupTransaction]
                    }])
                    .select()
                    .single()

                if (error) throw error
                
                console.log(`👤 New user created with bonus: ${phoneNumber} - ${this.SIGNUP_BONUS} tums`)
                return { user: data, isNew: true, signupBonus: this.SIGNUP_BONUS }
            }
        } catch (error) {
            console.error('❌ Error storing email:', error.message)
            throw error
        }
    }

    // Check if email is already taken
    static async isEmailTaken(email) {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('phone_number')
                .eq('email', email)
                .single()

            if (error && error.code !== 'PGRST116') throw error
            return !!data
        } catch (error) {
            console.error('❌ Error checking email:', error.message)
            return false
        }
    }

    // Add transaction and update wallet balance
    static async addTransaction(phoneNumber, transaction) {
        try {
            const user = await this.getUserByPhone(phoneNumber)
            if (!user) throw new Error('User not found')

            // Get current transactions array or initialize empty array
            const currentTransactions = user.transactions || []
            
            // Add new transaction to the beginning (most recent first)
            const updatedTransactions = [transaction, ...currentTransactions]

            // Calculate new balance
            let newBalance = user.wallet_balance || 0
            if (transaction.type === 'credit') {
                newBalance += transaction.tums_amount
            } else if (transaction.type === 'debit') {
                newBalance -= transaction.tums_amount
            }

            // Update user record
            const { data, error } = await supabase
                .from('users')
                .update({
                    wallet_balance: newBalance,
                    transactions: updatedTransactions,
                    updated_at: new Date().toISOString()
                })
                .eq('phone_number', phoneNumber)
                .select()
                .single()

            if (error) throw error
            
            console.log(`💰 Transaction added for ${phoneNumber}: ${transaction.type} ${transaction.tums_amount} tums`)
            return { user: data, newBalance }
        } catch (error) {
            console.error('❌ Error adding transaction:', error.message)
            throw error
        }
    }

    // Update wallet balance directly (for admin purposes)
    static async updateWalletBalance(phoneNumber, newBalance, reason = 'Admin adjustment') {
        try {
            const user = await this.getUserByPhone(phoneNumber)
            if (!user) throw new Error('User not found')

            const transaction = {
                id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: newBalance > (user.wallet_balance || 0) ? 'credit' : 'debit',
                tums_amount: Math.abs(newBalance - (user.wallet_balance || 0)),
                naira_amount: 0,
                description: reason,
                status: 'completed',
                reference: null,
                created_at: new Date().toISOString()
            }

            return await this.addTransaction(phoneNumber, transaction)
        } catch (error) {
            console.error('❌ Error updating wallet balance:', error.message)
            throw error
        }
    }

    // Deduct from wallet (for purchases/spending)
    static async deductFromWallet(phoneNumber, tumsAmount, description = 'Purchase') {
        try {
            const user = await this.getUserByPhone(phoneNumber)
            if (!user) throw new Error('User not found')

            const currentBalance = user.wallet_balance || 0
            if (currentBalance < tumsAmount) {
                throw new Error('Insufficient balance')
            }

            const transaction = {
                id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'debit',
                tums_amount: tumsAmount,
                naira_amount: 0,
                description: description,
                status: 'completed',
                reference: null,
                created_at: new Date().toISOString()
            }

            return await this.addTransaction(phoneNumber, transaction)
        } catch (error) {
            console.error('❌ Error deducting from wallet:', error.message)
            throw error
        }
    }
}

// Clean up rate limit storage every 5 minutes
setInterval(() => {
    UserService.cleanupRateLimit()
}, 5 * 60 * 1000)

module.exports = UserService