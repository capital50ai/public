#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const strategies = [
  {
    name: 'Growth Momentum',
    description: 'Focuses on high-growth momentum stocks with strong upward trends',
    color: '#60a5fa',
    risk_level: 'high',
  },
  {
    name: 'Value Discovery',
    description: 'Identifies undervalued assets with strong fundamentals for long-term growth',
    color: '#34d399',
    risk_level: 'medium',
  },
  {
    name: 'Dividend Income',
    description: 'Concentrates on stable dividend-paying companies for consistent returns',
    color: '#fbbf24',
    risk_level: 'low',
  },
  {
    name: 'Tech Innovation',
    description: 'Invests in cutting-edge technology companies driving industry transformation',
    color: '#a78bfa',
    risk_level: 'high',
  },
  {
    name: 'Market Neutral',
    description: 'Balances long and short positions to reduce overall market risk',
    color: '#fb7185',
    risk_level: 'low',
  },
  {
    name: 'Emerging Markets',
    description: 'Targets fast-growing emerging market economies with high growth potential',
    color: '#06b6d4',
    risk_level: 'high',
  },
];

const strategyReturns = [
  { months: 'Jan', returns: [2.5, 1.2, 0.8, 3.1, 0.5, 4.2] },
  { months: 'Feb', returns: [1.8, 2.3, 1.1, 2.5, 0.7, -0.3] },
  { months: 'Mar', returns: [3.2, 1.5, 0.9, 1.8, 1.2, 5.1] },
  { months: 'Apr', returns: [-0.5, 2.8, 1.3, -1.2, 0.8, 2.3] },
  { months: 'May', returns: [2.1, 3.2, 1.5, 2.9, 1.0, 3.8] },
  { months: 'Jun', returns: [1.9, 2.1, 0.7, 1.5, 0.9, 2.1] },
  { months: 'Jul', returns: [2.8, 1.9, 1.2, 3.5, 0.6, 4.2] },
  { months: 'Aug', returns: [1.5, 2.5, 1.0, 0.8, 1.1, -0.5] },
  { months: 'Sep', returns: [-1.2, 1.8, 0.9, 2.1, 0.5, 3.1] },
  { months: 'Oct', returns: [3.5, 3.1, 1.3, 2.8, 1.2, 4.9] },
  { months: 'Nov', returns: [2.2, 2.9, 1.1, 1.9, 0.8, 2.7] },
  { months: 'Dec', returns: [4.1, 2.5, 1.5, 3.2, 1.0, 5.3] },
];

async function seed() {
  try {
    console.log('🌱 Starting seed...');

    // Clear existing data
    console.log('Clearing existing strategies...');
    await supabase.from('strategies').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    // Insert strategies
    console.log('Inserting strategies...');
    const { data: insertedStrategies, error: strategiesError } = await supabase
      .from('strategies')
      .insert(strategies)
      .select();

    if (strategiesError) {
      throw new Error(`Failed to insert strategies: ${strategiesError.message}`);
    }

    console.log(`✓ Inserted ${insertedStrategies?.length || 0} strategies`);

    // Insert strategy returns
    if (insertedStrategies) {
      console.log('Inserting strategy returns...');
      let returnsCount = 0;

      for (let i = 0; i < strategyReturns.length; i++) {
        const monthData = strategyReturns[i];
        const returns = [];

        for (let j = 0; j < insertedStrategies.length; j++) {
          const strategy = insertedStrategies[j];
          const yearMonth = new Date(2024, i, 1).toISOString().split('T')[0];

          returns.push({
            strategy_id: strategy.id,
            year_month: yearMonth,
            monthly_return: monthData.returns[j],
          });
        }

        const { error } = await supabase.from('strategy_returns').insert(returns);
        if (error) {
          throw new Error(`Failed to insert returns for month ${i}: ${error.message}`);
        }

        returnsCount += returns.length;
      }

      console.log(`✓ Inserted ${returnsCount} strategy returns`);
    }

    console.log('✓ Seed completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('✗ Seed failed:', error);
    process.exit(1);
  }
}

seed();
