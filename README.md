# AI Assistant API

This is a simple Express.js API that integrates with OpenAI's GPT-3.5 to create an AI assistant.

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory with the following variables:
   ```
   PORT=3000
   OPENAI_API_KEY=your_api_key_here
   ```
   Replace `your_api_key_here` with your actual OpenAI API key.

## Running the Server

Start the server with:
```bash
node src/index.js
```

The server will run on port 3000 by default (or the port specified in your .env file).

## API Endpoints

### POST /api/chat
Send a message to the AI assistant.

Request body:
```json
{
  "message": "Your message here"
}
```

Response:
```json
{
  "response": "AI assistant's response"
}
```

### GET /health
Health check endpoint to verify the server is running.

Response:
```json
{
  "status": "OK"
}
```

## Error Handling

The API includes basic error handling and will return appropriate error messages if something goes wrong. 