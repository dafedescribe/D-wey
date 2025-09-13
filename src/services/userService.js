const { supabase } = require('../config/database')

class UserService {
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

    // Store user email and initialize wallet
    static async storeUserEmail(phoneNumber, displayName, email) {
        try {
            // Validate email
            if (!this.isValidEmail(email)) {
                throw new Error('Invalid email format')
            }

            // Check if user already exists
            const existingUser = await this.getUserByPhone(phoneNumber)

            if (existingUser) {
                // Update existing user's email
                const { data, error } = await supabase
                    .from('users')
                    .update({ 
                        email: email,
                        display_name: displayName,
                        updated_at: new Date().toISOString()
                    })
                    .eq('phone_number', phoneNumber)
                    .select()
                    .single()

                if (error) throw error
                console.log(`📧 Email updated for: ${phoneNumber}`)
                return { user: data, isNew: false }
            } else {
                // Create new user with wallet initialized to 0
                const { data, error } = await supabase
                    .from('users')
                    .insert([{
                        phone_number: phoneNumber,
                        display_name: displayName,
                        email: email,
                        wallet_balance: 0,
                        transactions: []
                    }])
                    .select()
                    .single()

                if (error) throw error
                console.log(`👤 New user created: ${phoneNumber}`)
                return { user: data, isNew: true }
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
                newBalance += transaction.coins_amount
            } else if (transaction.type === 'debit') {
                newBalance -= transaction.coins_amount
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
            
            console.log(`💰 Transaction added for ${phoneNumber}: ${transaction.type} ${transaction.coins_amount} coins`)
            return { user: data, newBalance }
        } catch (error) {
            console.error('❌ Error adding transaction:', error.message)
            throw error
        }
    }

    // Get user's transaction history (with optional limit)
    static async getTransactionHistory(phoneNumber, limit = 10) {
        try {
            const user = await this.getUserByPhone(phoneNumber)
            if (!user) return []

            const transactions = user.transactions || []
            return transactions.slice(0, limit)
        } catch (error) {
            console.error('❌ Error getting transaction history:', error.message)
            return []
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
                coins_amount: Math.abs(newBalance - (user.wallet_balance || 0)),
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
    static async deductFromWallet(phoneNumber, coinsAmount, description = 'Purchase') {
        try {
            const user = await this.getUserByPhone(phoneNumber)
            if (!user) throw new Error('User not found')

            const currentBalance = user.wallet_balance || 0
            if (currentBalance < coinsAmount) {
                throw new Error('Insufficient balance')
            }

            const transaction = {
                id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'debit',
                coins_amount: coinsAmount,
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

module.exports = UserService