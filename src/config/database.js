const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials in .env file')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Test connection
async function testConnection() {
    try {
        const { data, error } = await supabase.from('users').select('count').single()
        if (error && error.code !== 'PGRST116') {
            throw error
        }
        console.log('✅ Supabase connected successfully')
        return true
    } catch (error) {
        console.error('❌ Supabase connection failed:', error.message)
        console.error('💡 Make sure you\'ve created the users table')
        return false
    }
}

module.exports = { supabase, testConnection }