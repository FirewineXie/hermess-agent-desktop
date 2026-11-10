(() => {
  const name = 'hermess-dashboard-starter'
  const { React, components } = window.__HERMES_PLUGIN_SDK__
  const registry = window.__HERMES_PLUGINS__
  const h = React.createElement

  function StarterPage() {
    const [count, setCount] = React.useState(0)
    return h(components.Card, null,
      h(components.CardHeader, null, h(components.CardTitle, null, 'Dashboard Starter')),
      h(components.CardContent, null,
        h('p', null, 'This page is registered by a Hermess Dashboard plugin.'),
        h(components.Button, { onClick: () => setCount(value => value + 1) }, `Clicks: ${count}`),
      ),
    )
  }

  function ChatBanner() {
    return h('p', null, 'Dashboard Starter · chat:top')
  }

  registry.register(name, StarterPage)
  registry.registerSlot(name, 'chat:top', ChatBanner)
})()
