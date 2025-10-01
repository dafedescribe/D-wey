const { supabase } = require('../config/database')

class UserService {
    static rateLimitStorage = new Map()
    static RATE_LIMIT_WINDOW = 60000
    static MAX_REQUESTS_PER_MINUTE = 5
    static SIGNUP_BONUS = 1000

    // Rate limiting
    static checkRateLimit(phoneNumber, action = 'general') {
        const key = `${phoneNumber}_${action}`
        const now = Date.now()
        
        if (!this.rateLimitStorage.has(key)) {
            this.rateLimitStorage.set(key, { count: 1, resetTime: now + this.RATE_LIMIT_WINDOW })
            return { allowed: true, remaining: this.MAX_REQUESTS_PER_MINUTE - 1 }
        }
        
        const data = this.rateLimitStorage.get(key)
        
        if (now > data.resetTime) {
            this.rateLimitStorage.set(key, { count: 1, resetTime: now + this.RATE_LIMIT_WINDOW })
            return { allowed: true, remaining: this.MAX_REQUESTS_PER_MINUTE - 1 }
        }
        
        if (data.count >= this.MAX_REQUESTS_PER_MINUTE) {
            const resetIn = Math.ceil((data.resetTime - now) / 1000)
            return { 
                allowed: false, 
                remaining: 0, 
                resetIn,
                message: `⚠️ Rate limit exceeded. Wait ${resetIn} seconds.`
            }
        }
        
        data.count++
        return { allowed: true, remaining: this.MAX_REQUESTS_PER_MINUTE - data.count }
    }

    static cleanupRateLimit() {
        const now = Date.now()
        for (const [key, data] of this.rateLimitStorage.entries()) {
            if (now > data.resetTime) {
                this.rateLimitStorage.delete(key)
            }
        }
    }

    // Get user by phone
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
            console.error('Error getting user:', error.message)
            return null
        }
    }

    // Soft register user (no email required)
    static async softRegisterUser(phoneNumber, displayName = null) {
        try {
            const existingUser = await this.getUserByPhone(phoneNumber)
            
            if (existingUser) {
                return { user: existingUser, isNew: false }
            }

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
                    display_name: displayName || `User_${phoneNumber.slice(-4)}`,
                    wallet_balance: this.SIGNUP_BONUS,
                    transactions: [signupTransaction]
                }])
                .select()
                .single()

            if (error) throw error
            
            console.log(`New user registered: ${phoneNumber} - ${this.SIGNUP_BONUS} tums`)
            return { user: data, isNew: true, signupBonus: this.SIGNUP_BONUS }

        } catch (error) {
            console.error('Error registering user:', error.message)
            throw error
        }
    }

    // Add transaction and update wallet
    static async addTransaction(phoneNumber, transaction) {
        try {
            const user = await this.getUserByPhone(phoneNumber)
            if (!user) throw new Error('User not found')

            const currentTransactions = user.transactions || []
            const updatedTransactions = [transaction, ...currentTransactions]

            let newBalance = user.wallet_balance || 0
            if (transaction.type === 'credit') {
                newBalance += transaction.tums_amount
            } else if (transaction.type === 'debit') {
                newBalance -= transaction.tums_amount
            }

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
            
            console.log(`Transaction added: ${phoneNumber} - ${transaction.type} ${transaction.tums_amount} tums`)
            return { user: data, newBalance }
        } catch (error) {
            console.error('Error adding transaction:', error.message)
            throw error
        }
    }

    // Deduct from wallet
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
            console.error('Error deducting from wallet:', error.message)
            throw error
        }
    }

    // Update wallet balance
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
            console.error('Error updating wallet:', error.message)
            throw error
        }
    }
}

setInterval(() => {
    UserService.cleanupRateLimit()
}, 5 * 60 * 1000)

module.exports = UserService