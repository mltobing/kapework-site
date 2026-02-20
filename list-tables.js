#!/usr/bin/env node

const SUPABASE_URL = "https://fimsbfcvavpehryvvcho.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpbXNiZmN2YXZwZWhyeXZ2Y2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzOTEwMDMsImV4cCI6MjA3MDk2NzAwM30.6uAm_bDPN9aetYaKWA7zCvS8XDEVhmKKxA7RA7YK4JQ";

// Query the database using REST API
const url = `${SUPABASE_URL}/rest/v1/information_schema.tables?select=table_name,table_schema&table_schema=eq.public&order=table_name`;

fetch(url, {
  headers: {
    'apikey': SUPABASE_ANON,
    'Authorization': `Bearer ${SUPABASE_ANON}`,
  }
})
  .then(res => res.json())
  .then(data => {
    if (data.error) {
      console.error('Error:', data.error);
      return;
    }

    console.log('\n📊 Supabase Tables\n');
    console.log('Tables in your database:');
    console.log('─'.repeat(40));

    data.forEach((table, index) => {
      console.log(`${index + 1}. ${table.table_name}`);
    });

    console.log('─'.repeat(40));
    console.log(`Total: ${data.length} table(s)\n`);
  })
  .catch(err => {
    console.error('Error fetching tables:', err.message);
  });
