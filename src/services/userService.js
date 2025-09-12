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

    // Store user email
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
                // Create new user
                const { data, error } = await supabase
                    .from('users')
                    .insert([{
                        phone_number: phoneNumber,
                        display_name: displayName,
                        email: email
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
}

module.exports = UserService