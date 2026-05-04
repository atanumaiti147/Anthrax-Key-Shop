const axios = require('axios');

module.exports.generateKey = async (expiryDate, maxDevices, note) => {
  const response = await axios.post(`${process.env.KEYGEN_API_URL}/api/v1/generate-key`, {
    expiryDate,
    maxDevices,
    note,
    apiSecret: process.env.API_SECRET_KEY
  });
  if (!response.data.success) throw new Error(response.data.error);
  return response.data.key;
};