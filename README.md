# Hello World - Deploy an Agent to Prod via Trigger.dev

A hello world [Trigger.dev](https://trigger.dev) project. Create a single background task, which echos the name you provide.

## Layout

```
trigger.config.ts        # project ref + config. This links the repo to the project you create in your trigger.dev account
src/trigger/hello-world.ts  # the hello world task
```

## Commands

Simply asking claude to "run dev server" should spin up a server on your local to test the task.
Asking claide to "deploy to prod", will run the command to push your changes to a production task in trigger.dev.


## API Keys

Ensure to add your trigger development and production API keys to a .env file


## Accompanying Video
