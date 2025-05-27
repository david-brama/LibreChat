/**
 * Script to populate the models table with initial model configurations
 * Uses the actual local SQLite database from .wrangler directory
 *
 * Prerequisites:
 * 1. Run `npm run dev` first to initialize the local database
 * 2. Stop the dev server before running this script
 *
 * Usage: npx tsx scripts/populate-models.ts
 */

import { ModelRepository } from '../src/db/repositories/model';
import { CreateModelDTO } from '../src/types';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Default model configurations to populate
 * Based on the specifications provided
 */
const DEFAULT_MODELS: CreateModelDTO[] = [
  {
    name: 'Sonnet 4',
    modelId: 'claude-sonnet-4-20250514',
    endpointType: 'anthropic',
    thinking: true,
    contextWindow: 200000,
    maxOutput: 64000,
    knowledgeCutoff: '2025-03-01T00:00:00Z',
    inputPricePerMtok: 3,
    outputPricePerMtok: 15,
    isActive: true,
  },
  {
    name: 'GPT-4.1',
    modelId: 'gpt-4.1',
    endpointType: 'openAI',
    thinking: false,
    contextWindow: 128000,
    maxOutput: 4096,
    knowledgeCutoff: '2024-10-01T00:00:00Z',
    inputPricePerMtok: 10,
    outputPricePerMtok: 30,
    isActive: true,
  },
  {
    name: 'GPT-4.1 Nano',
    modelId: 'gpt-4.1-nano',
    endpointType: 'openAI',
    thinking: false,
    contextWindow: 32000,
    maxOutput: 2048,
    knowledgeCutoff: '2024-10-01T00:00:00Z',
    inputPricePerMtok: 2,
    outputPricePerMtok: 8,
    isActive: true,
  },
];

/**
 * Create a D1-compatible database wrapper for the local SQLite database
 * Uses the actual .wrangler SQLite file for local development
 */
function createLocalDatabase(): D1Database {
  // Find the SQLite file in the .wrangler directory
  const wranglerDbDir = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';

  if (!fs.existsSync(wranglerDbDir)) {
    throw new Error(
      `Wrangler database directory not found: ${wranglerDbDir}\n` +
        'Make sure to run `npm run dev` first to initialize the local database.',
    );
  }

  const files = fs.readdirSync(wranglerDbDir).filter((f) => f.endsWith('.sqlite'));

  if (files.length === 0) {
    throw new Error(
      `No SQLite file found in ${wranglerDbDir}\n` +
        'Make sure to run `npm run dev` first to initialize the local database.',
    );
  }

  if (files.length > 1) {
    console.warn(`Multiple SQLite files found, using the first one: ${files[0]}`);
  }

  const sqliteFile = path.join(wranglerDbDir, files[0]);
  console.log(`📁 Using SQLite database: ${sqliteFile}`);

  const sqlite = new Database(sqliteFile);

  // Create a D1-compatible interface
  return {
    prepare: (query: string) => ({
      bind: (...args: any[]) => ({
        run: async () => {
          console.log(`🔍 SQL: ${query.trim()}`);
          console.log(`🔗 Bindings:`, args);

          try {
            const stmt = sqlite.prepare(query);
            // Convert booleans to integers for SQLite compatibility
            const sqliteArgs = args.map((arg) => (typeof arg === 'boolean' ? (arg ? 1 : 0) : arg));
            const result = stmt.run(...sqliteArgs);
            console.log(`✅ Affected rows: ${result.changes}`);

            return { meta: { changes: result.changes } };
          } catch (error) {
            console.error(`❌ SQL Error:`, error);
            throw error;
          }
        },
        first: async <T>() => {
          console.log(`🔍 SQL: ${query.trim()}`);
          console.log(`🔗 Bindings:`, args);

          try {
            const stmt = sqlite.prepare(query);
            // Convert booleans to integers for SQLite compatibility
            const sqliteArgs = args.map((arg) => (typeof arg === 'boolean' ? (arg ? 1 : 0) : arg));
            const result = stmt.get(...sqliteArgs) as T | undefined;
            console.log(`📄 Result:`, result ? 'Found' : 'Not found');

            return result || null;
          } catch (error) {
            console.error(`❌ SQL Error:`, error);
            throw error;
          }
        },
        all: async <T>() => {
          console.log(`🔍 SQL: ${query.trim()}`);
          console.log(`🔗 Bindings:`, args);

          try {
            const stmt = sqlite.prepare(query);
            // Convert booleans to integers for SQLite compatibility
            const sqliteArgs = args.map((arg) => (typeof arg === 'boolean' ? (arg ? 1 : 0) : arg));
            const results = stmt.all(...sqliteArgs) as T[];
            console.log(`📋 Results: ${results.length} rows`);

            return { results };
          } catch (error) {
            console.error(`❌ SQL Error:`, error);
            throw error;
          }
        },
      }),
    }),
  } as D1Database;
}

/**
 * Main function to populate the models table
 */
async function populateModels() {
  try {
    console.log('🚀 Starting model population...');

    // Use the actual local SQLite database from .wrangler
    const db = createLocalDatabase();
    const modelRepository = new ModelRepository(db);

    console.log(`📝 Adding ${DEFAULT_MODELS.length} models to the database...\n`);

    let created = 0;
    let skipped = 0;

    for (const modelData of DEFAULT_MODELS) {
      try {
        console.log(`🔍 Checking model: ${modelData.name} (${modelData.modelId})`);
        console.log(`   - Endpoint: ${modelData.endpointType}`);
        console.log(`   - Context Window: ${modelData.contextWindow.toLocaleString()} tokens`);
        console.log(`   - Max Output: ${modelData.maxOutput.toLocaleString()} tokens`);
        console.log(`   - Thinking: ${modelData.thinking ? 'Yes' : 'No'}`);
        console.log(`   - Input Price: $${modelData.inputPricePerMtok}/MTok`);
        console.log(`   - Output Price: $${modelData.outputPricePerMtok}/MTok`);

        // Check if model already exists
        const existingModel = await modelRepository.findByModelId(modelData.modelId);
        if (existingModel) {
          console.log(`   ⏭️  Model already exists, skipping\n`);
          skipped++;
          continue;
        }

        await modelRepository.create(modelData);
        console.log(`   ✅ Successfully added ${modelData.name}\n`);
        created++;
      } catch (error) {
        console.error(`   ❌ Error adding ${modelData.name}:`, error);
        console.log('');
      }
    }

    console.log('🎉 Model population completed!');
    console.log('\n📊 Summary:');
    console.log(`   - Created: ${created} models`);
    console.log(`   - Skipped: ${skipped} models (already exist)`);
    console.log(`   - Total processed: ${DEFAULT_MODELS.length} models`);

    console.log('\n💡 Next steps:');
    console.log('   1. Start the development server: npm run dev');
    console.log('   2. Check the models API: http://localhost:8787/api/models');
    console.log('   3. For production: Deploy worker and populate via admin API');
  } catch (error) {
    console.error('💥 Error during model population:', error);
    process.exit(1);
  }
}

/**
 * Helper function to add a single model
 * Can be called directly for manual model addition
 */
export async function addModel(modelData: CreateModelDTO, db: D1Database) {
  const modelRepository = new ModelRepository(db);
  return await modelRepository.create(modelData);
}

/**
 * Helper function to list all models
 * Useful for verification after population
 */
export async function listModels(db: D1Database) {
  const modelRepository = new ModelRepository(db);
  return await modelRepository.findAll();
}

// Run the script if called directly
if (require.main === module) {
  populateModels().catch(console.error);
}
