import '@testing-library/jest-dom';

// Provide a default VITE_API_URL for tests if not provided
if (typeof process !== 'undefined') {
    process.env.VITE_API_URL = process.env.VITE_API_URL || 'http://localhost:3000/api';
}
