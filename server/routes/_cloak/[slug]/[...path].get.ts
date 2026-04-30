export default eventHandler(async (event) => {
  return handleCloakProxy(event, getRouterParam(event, 'path'))
})
