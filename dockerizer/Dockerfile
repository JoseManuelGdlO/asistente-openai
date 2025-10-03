# Base image
FROM node:20

# Create app directory
WORKDIR /app

# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install app dependencies
RUN npm install

# Bundle app source
COPY . .

# Start the server using the production build
CMD [ "node", "src/index.js" ]

# Exposing server port
EXPOSE 3000