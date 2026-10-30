// API Gateway HTTP API compatible; also used by the local server.

export const handler = async () => {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status: "ok",
      message: "Aussie EcoGuard backend is running!",
    }),
  };
};
