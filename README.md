# WhatsApp AI Assistant

This is a WhatsApp bot that integrates with OpenAI's GPT-4 to create an AI assistant that responds to WhatsApp messages.

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory with the following variables:
   ```
   PORT=3000
   OPENAI_API_KEY=your_openai_api_key_here
   ASISTENTE_ID=your_assistant_id_here
   WHATSAPP_TOKEN=your_whatsapp_token_here
   WHATSAPP_VERIFY_TOKEN=your_verify_token_here
   ```
   Replace the values with your actual API keys and tokens.

## Running the Server

1. Start the server:
   ```bash
   npm start
   ```

2. Start ngrok to expose your local server:
   ```bash
   npm run ngrok
   ```

3. Configure your WhatsApp webhook in Meta Developer Console with the ngrok URL.

The server will run on port 3000 by default (or the port specified in your .env file).

## API Endpoints

### POST /webhook
WhatsApp webhook endpoint that receives messages and responds using OpenAI.

### GET /webhook
WhatsApp webhook verification endpoint.

### GET /health
Health check endpoint to verify the server is running.

### POST /test
Test endpoint for debugging webhook functionality.

Response:
```json
{
  "status": "OK"
}
```

## Scripts

- `npm start` - Start the server
- `npm run dev` - Start the server in development mode with nodemon
- `npm run ngrok` - Start ngrok to expose the server
- `npm run test-webhook` - Test the webhook locally
- `npm run create-assistant` - Create a new OpenAI assistant
- `npm run list-assistants` - List existing OpenAI assistants

## Error Handling

The API includes basic error handling and will return appropriate error messages if something goes wrong. 