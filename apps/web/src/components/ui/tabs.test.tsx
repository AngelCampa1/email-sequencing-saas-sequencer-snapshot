import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Tabs, TabsList, TabsTrigger } from './tabs'

describe('TabsTrigger', () => {
  it('renders its label', () => {
    const markup = renderToStaticMarkup(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">First</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    expect(markup).toContain('First')
  })

  it('gives the trigger a visible keyboard focus ring', () => {
    const markup = renderToStaticMarkup(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">First</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    // A keyboard user tabbing onto the tab must see where focus landed.
    expect(markup).toContain('focus-visible:outline')
  })
})
