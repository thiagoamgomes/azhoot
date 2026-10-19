import base from '@azhoot/config-eslint/base';

export default [...base, { files: ['scripts/**'], rules: { 'no-console': 'off' } }];
