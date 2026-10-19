import react from '@azhoot/config-eslint/react';

export default [...react, { ignores: ['playwright-report/**', 'test-results/**'] }];
