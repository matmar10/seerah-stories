export function httpErrorInterceptor(err: any): Promise<never> {
  // Check if the error has a response and a data property
  if (err.response && err.response.data) {
    // Log the data from the error response
    console.error('Error data:', err.response.data);
  } else {
    // If there's no response or data, log the entire error
    console.error('Error:', err.message || err);
  }
  // Reject the promise to propagate the error
  return Promise.reject(err);
}