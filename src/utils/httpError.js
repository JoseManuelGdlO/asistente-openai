function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function sendHttpError(res, error) {
  const status = Number(error?.status) >= 400 && Number(error.status) < 600
    ? Number(error.status)
    : 500;
  return res.status(status).json({
    ok: false,
    error: error?.message || 'Error interno'
  });
}

module.exports = {
  httpError,
  sendHttpError
};
