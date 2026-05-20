'use strict';
require('dotenv').config();
const intelligence = require('../intelligence');

intelligence.runBatchAnalysis()
  .then(() => {
    console.log('Batch analysis complete');
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
