FROM node:12

ARG APP_DIR=app
RUN mkdir -p ${APP_DIR}
WORKDIR ${APP_DIR}

COPY . .
RUN yarn install

CMD ["yarn", "start"]