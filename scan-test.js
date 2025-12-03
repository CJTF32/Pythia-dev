export async function onRequest(context) {
  return new Response(JSON.stringify({
    status: "TEST FILE WORKING",
    message: "This is the new scan-test.js file"
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
