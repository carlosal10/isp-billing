'use strict';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const DEFAULT_MODELS_DIR = path.resolve(__dirname, '..', 'models');
const SKIPPED_MODEL_FILES = new Set(['playground-1.mongodb.js']);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function indexKey(spec = {}) {
  return Object.entries(spec)
    .map(([field, direction]) => `${field}:${String(direction)}`)
    .join('|');
}

function normalizeIndexOptions(options = {}) {
  const relevant = {};
  [
    'unique',
    'sparse',
    'expireAfterSeconds',
    'partialFilterExpression',
    'collation',
    'weights',
  ].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      relevant[key] = options[key];
    }
  });
  return relevant;
}

function indexSignature(spec = {}, options = {}) {
  return `${indexKey(spec)}::${stableStringify(normalizeIndexOptions(options))}`;
}

function loadModelFiles(modelsDir = DEFAULT_MODELS_DIR) {
  return fs
    .readdirSync(modelsDir)
    .filter((fileName) => fileName.endsWith('.js') && !SKIPPED_MODEL_FILES.has(fileName))
    .sort()
    .map((fileName) => {
      const filePath = path.join(modelsDir, fileName);
      require(filePath);
      return filePath;
    });
}

function declaredIndexesForModel(model) {
  return model.schema.indexes().map(([spec, options = {}]) => ({
    key: indexKey(spec),
    signature: indexSignature(spec, options),
    spec,
    options: normalizeIndexOptions(options),
  }));
}

function modelIndexExpectations(models = mongoose.models) {
  return Object.values(models)
    .sort((left, right) => left.modelName.localeCompare(right.modelName))
    .map((model) => ({
      modelName: model.modelName,
      collectionName: model.collection.name,
      indexes: declaredIndexesForModel(model),
    }))
    .filter((item) => item.indexes.length > 0);
}

function compareDeclaredIndexes(expectedIndexes = [], actualIndexes = []) {
  const actualByKey = new Map(
    actualIndexes.map((index) => [indexKey(index.key || index.spec || {}), index])
  );

  return expectedIndexes
    .filter((expected) => !actualByKey.has(expected.key))
    .map((expected) => ({
      key: expected.key,
      spec: expected.spec,
      options: expected.options,
    }));
}

function compareDeclaredIndexDrift(expectedIndexes = [], actualIndexes = []) {
  const actualByKey = new Map(
    actualIndexes.map((index) => [indexKey(index.key || index.spec || {}), index])
  );
  const missing = [];
  const mismatched = [];

  expectedIndexes.forEach((expected) => {
    const actual = actualByKey.get(expected.key);
    if (!actual) {
      missing.push({
        key: expected.key,
        spec: expected.spec,
        options: expected.options,
      });
      return;
    }

    const actualOptions = normalizeIndexOptions(actual);
    if (stableStringify(expected.options) !== stableStringify(actualOptions)) {
      mismatched.push({
        key: expected.key,
        expectedOptions: expected.options,
        actualOptions,
      });
    }
  });

  return { missing, mismatched };
}

async function auditDeclaredIndexes(options = {}) {
  if (options.loadModels !== false) {
    loadModelFiles(options.modelsDir || DEFAULT_MODELS_DIR);
  }

  const expectations = modelIndexExpectations(options.models || mongoose.models);
  const collections = [];

  for (const expectation of expectations) {
    const model = mongoose.model(expectation.modelName);
    const actualIndexes = await model.collection.indexes();
    const drift = compareDeclaredIndexDrift(expectation.indexes, actualIndexes);
    collections.push({
      modelName: expectation.modelName,
      collectionName: expectation.collectionName,
      expectedCount: expectation.indexes.length,
      actualCount: actualIndexes.length,
      missing: drift.missing,
      mismatched: drift.mismatched,
    });
  }

  return {
    ok: collections.every(
      (collection) => collection.missing.length === 0 && collection.mismatched.length === 0
    ),
    collections,
  };
}

module.exports = {
  auditDeclaredIndexes,
  compareDeclaredIndexDrift,
  compareDeclaredIndexes,
  declaredIndexesForModel,
  indexKey,
  indexSignature,
  loadModelFiles,
  modelIndexExpectations,
  normalizeIndexOptions,
  stableStringify,
};
