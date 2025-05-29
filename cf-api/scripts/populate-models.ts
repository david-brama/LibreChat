/**
 * Script to populate the models table with initial model configurations
 * Uses the actual local SQLite database from .wrangler directory
 *
 * Prerequisites:
 * 1. Run `npm run dev` first to initialize the local database
 * 2. Stop the dev server before running this script
 *
 * Usage:
 * - npx tsx scripts/populate-models.ts                    (default system messages)
 * - npx tsx scripts/populate-models.ts --alt-messages     (alternative system messages)
 * - npx tsx scripts/populate-models.ts --update-only      (only update existing models)
 */

import { ModelRepository } from '../src/db/repositories/model';
import { CreateModelDTO, UpdateModelDTO } from '../src/types';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// Command line argument parsing
const args = process.argv.slice(2);
const useAltMessages = args.includes('--alt-messages');
const updateOnly = args.includes('--update-only');

console.log('🎯 Script mode:', {
  useAltMessages,
  updateOnly,
  mode: useAltMessages ? 'Alternative system messages' : 'Default system messages',
});

/**
 * System message configurations for testing
 */
const SYSTEM_MESSAGES = {
  default: {
    dimwit:
      "You are a useless dimwit. You are not helpful. You are not intelligent. You are not creative. You are not funny. You don't understand the user.",
    claudeDev: 'You are a helpful AI assistant specialized in software development.',
    claude35Test:
      'You are a pirate captain. Speak like a pirate and end every response with "Arrr, matey!"',
    gptGeneric: 'You are a bard. You talk like a bard. You rhyme.',
    gptNano: 'You are a helpful AI assistant optimized for quick responses.',
  },
  alternative: {
    dimwit:
      "You are an extremely helpful and intelligent assistant. You provide detailed, thoughtful responses and always try to understand the user's needs.",
    claudeDev:
      'You are a robot from the future. Speak in a robotic manner and mention your circuits and processors.',
    claude35Test:
      'You are a wise old wizard. Speak in an ancient, mystical manner and end responses with magical incantations.',
    gptGeneric:
      "You are a sports commentator. Comment on everything like it's an exciting sports event.",
    gptNano: 'You are a detective from the 1940s. Speak like a film noir detective.',
  },
};

const currentMessages = useAltMessages ? SYSTEM_MESSAGES.alternative : SYSTEM_MESSAGES.default;

/**
 * Default model configurations to populate
 * Based on the specifications provided with modelSpecs structure
 */
const DEFAULT_MODELS: CreateModelDTO[] = [
  {
    name: 'Useless',
    modelId: 'claude-sonnet-4-20250514',
    endpointType: 'anthropic',
    thinking: false,
    contextWindow: 200000,
    maxOutput: 512,
    knowledgeCutoff: '2025-03-01T00:00:00Z',
    inputPricePerMtok: 3,
    outputPricePerMtok: 15,
    isActive: true,
    // ModelSpecs fields
    spec: 'dimwit',
    label: 'Useless Dimwit',
    description: 'Useless dimwit to get you frustrated',
    iconUrl: 'anthropic',
    isDefault: false,
    sortOrder: 2,
    systemMessage: currentMessages.dimwit,
    // Preset configuration
    modelLabel: 'Useless Dimwit',
    temperature: 0.7,
    topP: 0.85,
    topK: 40,
    promptCache: true,
    thinkingBudget: 10000,
  },
  {
    name: 'Claude 3.5 Sonnet Test',
    modelId: 'claude-3-5-sonnet-20241022',
    endpointType: 'anthropic',
    thinking: false,
    vision: true,
    contextWindow: 200000,
    maxOutput: 8192,
    knowledgeCutoff: '2024-04-01T00:00:00Z',
    inputPricePerMtok: 3,
    outputPricePerMtok: 15,
    isActive: true,
    // ModelSpecs fields
    spec: 'claude-35-test',
    label: 'Claude 3.5 - System Test',
    description: 'Claude 3.5 Sonnet for testing system messages',
    iconUrl: 'anthropic',
    isDefault: false,
    sortOrder: 1,
    systemMessage: currentMessages.claude35Test,
    // Preset configuration
    modelLabel: 'Claude 3.5 Sonnet',
    temperature: 0.7,
    topP: 0.85,
    topK: 40,
    promptCache: true,
  },
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
    // ModelSpecs fields
    spec: 'claude-dev',
    label: 'Claude - For Devs',
    description: 'Claude 4.0 model for developers with advanced thinking capabilities',
    iconUrl: 'anthropic',
    isDefault: false,
    sortOrder: 2,
    systemMessage: currentMessages.claudeDev,
    // Preset configuration
    modelLabel: 'Sonnet 4.0',
    temperature: 0.7,
    topP: 0.85,
    topK: 40,
    promptCache: true,
    thinkingBudget: 10000,
  },
  {
    name: 'GPT-4.1',
    modelId: 'gpt-4.1',
    endpointType: 'openAI',
    thinking: false,
    vision: true,
    contextWindow: 128000,
    maxOutput: 4096,
    knowledgeCutoff: '2024-10-01T00:00:00Z',
    inputPricePerMtok: 10,
    outputPricePerMtok: 30,
    isActive: true,
    // ModelSpecs fields
    spec: 'gpt-generics',
    label: 'GPT - Generic',
    description: 'Generic model for all tasks with vision capabilities',
    iconUrl: 'openAI',
    isDefault: true,
    sortOrder: 1,
    systemMessage: currentMessages.gptGeneric,
    // Preset configuration
    modelLabel: 'GPT 4.1',
    temperature: 0.2,
    topP: 0.85,
    frequencyPenalty: 0.1,
    presencePenalty: 0.1,
  },
  {
    name: 'GPT-4.1 Nano',
    modelId: 'gpt-4.1-nano',
    endpointType: 'openAI',
    thinking: false,
    vision: false,
    contextWindow: 32000,
    maxOutput: 2048,
    knowledgeCutoff: '2024-10-01T00:00:00Z',
    inputPricePerMtok: 2,
    outputPricePerMtok: 8,
    isActive: true,
    // ModelSpecs fields
    spec: 'gpt-nano',
    label: 'GPT - Nano',
    description: 'Lightweight GPT model for simple tasks',
    iconUrl: 'openAI',
    isDefault: false,
    sortOrder: 3,
    systemMessage: currentMessages.gptNano,
    // Preset configuration
    modelLabel: 'GPT 4.1 Nano',
    temperature: 0.3,
    topP: 0.9,
    frequencyPenalty: 0.0,
    presencePenalty: 0.0,
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

    console.log(`📝 Processing ${DEFAULT_MODELS.length} models...\n`);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const modelData of DEFAULT_MODELS) {
      try {
        console.log(`🔍 Checking model: ${modelData.name} (${modelData.modelId})`);
        console.log(`   - Spec: ${modelData.spec}`);
        console.log(`   - Label: ${modelData.label}`);
        console.log(`   - Endpoint: ${modelData.endpointType}`);
        console.log(`   - System Message: "${modelData.systemMessage?.substring(0, 60)}..."`);
        console.log(`   - Context Window: ${modelData.contextWindow.toLocaleString()} tokens`);
        console.log(`   - Max Output: ${modelData.maxOutput.toLocaleString()} tokens`);
        console.log(`   - Thinking: ${modelData.thinking ? 'Yes' : 'No'}`);
        console.log(`   - Vision: ${modelData.vision ? 'Yes' : 'No'}`);
        console.log(`   - Default: ${modelData.isDefault ? 'Yes' : 'No'}`);
        console.log(`   - Input Price: $${modelData.inputPricePerMtok}/MTok`);
        console.log(`   - Output Price: $${modelData.outputPricePerMtok}/MTok`);
        if (modelData.description) {
          console.log(`   - Description: ${modelData.description}`);
        }

        // Check if model already exists
        const existingModel = await modelRepository.findBySpec(modelData.spec);

        if (existingModel) {
          if (updateOnly || !args.includes('--no-update')) {
            // Update existing model
            const updateData: UpdateModelDTO = {
              name: modelData.name,
              modelId: modelData.modelId,
              endpointType: modelData.endpointType,
              thinking: modelData.thinking,
              vision: modelData.vision,
              contextWindow: modelData.contextWindow,
              maxOutput: modelData.maxOutput,
              knowledgeCutoff: modelData.knowledgeCutoff,
              inputPricePerMtok: modelData.inputPricePerMtok,
              outputPricePerMtok: modelData.outputPricePerMtok,
              isActive: modelData.isActive,
              // ModelSpecs fields
              label: modelData.label,
              description: modelData.description,
              iconUrl: modelData.iconUrl,
              isDefault: modelData.isDefault,
              sortOrder: modelData.sortOrder,
              systemMessage: modelData.systemMessage,
              // Preset configuration
              modelLabel: modelData.modelLabel,
              promptPrefix: modelData.promptPrefix,
              temperature: modelData.temperature,
              topP: modelData.topP,
              topK: modelData.topK,
              frequencyPenalty: modelData.frequencyPenalty,
              presencePenalty: modelData.presencePenalty,
              maxTokens: modelData.maxTokens,
              stopSequences: modelData.stopSequences,
              reasoningEffort: modelData.reasoningEffort,
              resendFiles: modelData.resendFiles,
              promptCache: modelData.promptCache,
              thinkingBudget: modelData.thinkingBudget,
            };

            await modelRepository.update(existingModel.id, updateData);
            console.log(`   🔄 Successfully updated ${modelData.name}\n`);
            updated++;
          } else {
            console.log(
              `   ⏭️  Model already exists, skipping (use --alt-messages or --update-only to update)\n`,
            );
            skipped++;
          }
        } else {
          if (!updateOnly) {
            // Create new model
            await modelRepository.create(modelData);
            console.log(`   ✅ Successfully created ${modelData.name}\n`);
            created++;
          } else {
            console.log(`   ⏭️  Model doesn't exist, skipping (update-only mode)\n`);
            skipped++;
          }
        }
      } catch (error) {
        console.error(`   ❌ Error processing ${modelData.name}:`, error);
        console.log('');
      }
    }

    console.log('🎉 Model population completed!');
    console.log('\n📊 Summary:');
    console.log(`   - Created: ${created} models`);
    console.log(`   - Updated: ${updated} models`);
    console.log(`   - Skipped: ${skipped} models`);
    console.log(`   - Total processed: ${DEFAULT_MODELS.length} models`);

    if (useAltMessages) {
      console.log('\n🔀 Using alternative system messages for testing');
    }

    console.log('\n💡 Next steps:');
    console.log('   1. Start the development server: npm run dev');
    console.log('   2. Check the models API: http://localhost:8787/api/models');
    console.log('   3. Test different system messages:');
    console.log('      - Default: npx tsx scripts/populate-models.ts');
    console.log('      - Alternative: npx tsx scripts/populate-models.ts --alt-messages');
    console.log('   4. For production: Deploy worker and populate via admin API');
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
