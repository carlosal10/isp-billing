export function validateApiResponse(response) {
  const type = String(response.headers?.['content-type'] || '').toLowerCase();
  const data = response.data;
  if (type.includes('text/html') || (typeof data === 'string' && /^\s*(?:<!doctype html|<html)/i.test(data))) {
    throw new Error('The website is reaching a web page instead of the API. Configure the frontend API address and rebuild the website.');
  }
  if (String(response.config?.url || '').match(/\/auth\/(login|register)$/) && (!data || typeof data !== 'object')) {
    throw new Error('The sign-in service returned an empty or invalid response. Check the frontend API address and backend deployment.');
  }
  return response;
}
