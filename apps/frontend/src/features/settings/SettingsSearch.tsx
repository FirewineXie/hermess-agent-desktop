import React from 'react'
import { useDesktop } from '../../app/DesktopContext'
import { agentFieldTranslation, type Language } from '../../i18n'
import { auxiliaryTaskFromField, fieldSettingsLocation, fieldSupportsTextTarget } from './fieldSearch'
import { SETTINGS_CATEGORIES, type SettingsLocation } from './model'

type SearchEntry = {
  id: string
  label: string
  context: string
  description: string
  location: SettingsLocation
  field?: string
  searchKey?: string
}

type Props = {
  language: Language
  connected: boolean
  profile: string | null
  onSelect: (location: SettingsLocation, field?: string) => boolean
}

export default function SettingsSearch({ language, connected, profile, onSelect }: Props) {
  const { agentSettings } = useDesktop()
  const [query, setQuery] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(0)
  const [fields, setFields] = React.useState<Record<string, { description?: string }>>({})
  const [loading, setLoading] = React.useState(false)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    let current = true
    setFields({})
    setLoadFailed(false)
    setLoading(Boolean(connected && profile))
    if (!connected || !profile) return () => { current = false }
    void agentSettings.schema({ kind: 'profile', profile }).then(schema => {
      if (current) { setFields(schema.fields || {}); setLoading(false) }
    }).catch(() => { if (current) { setLoadFailed(true); setLoading(false) } })
    return () => { current = false }
  }, [agentSettings, connected, profile])

  const entries = React.useMemo(() => {
    const pages: SearchEntry[] = SETTINGS_CATEGORIES.flatMap(category => category.subpages.map(subpage => ({
      id: `page:${category.id}.${subpage.id}`,
      label: subpage.label[language],
      context: category.label[language],
      description: category.description[language],
      location: { category: category.id, subpage: subpage.id },
    })))
    const fieldEntries: SearchEntry[] = Object.entries(fields).flatMap(([key, field]) => {
      const location = fieldSettingsLocation(key)
      if (!location) return []
      const category = SETTINGS_CATEGORIES.find(item => item.id === location.category)!
      const subpage = category.subpages.find(item => item.id === location.subpage)!
      const copy = agentFieldTranslation(language, key)
      return [{
        id: `field:${key}`,
        label: copy?.label || key,
        context: `${category.label[language]} · ${subpage.label[language]}`,
        description: copy?.description || field.description || '',
        location,
        field: fieldSupportsTextTarget(key) || auxiliaryTaskFromField(key) ? key : undefined,
        searchKey: key,
      }]
    })
    return [...pages, ...fieldEntries]
  }, [fields, language])
  const normalized = query.trim().toLocaleLowerCase()
  const results = normalized ? entries.filter(entry =>
    `${entry.label} ${entry.context} ${entry.description} ${entry.searchKey || ''}`.toLocaleLowerCase().includes(normalized)
  ).slice(0, 12) : []
  const selectedIndex = results.length ? Math.min(activeIndex, results.length - 1) : -1

  function choose(entry: SearchEntry) {
    if (onSelect(entry.location, entry.field)) {
      setQuery('')
      inputRef.current?.blur()
    }
  }

  return <div className="settings-search">
    <label htmlFor="settings-search-input">{language === 'zh-CN' ? '搜索设置' : 'Search settings'}</label>
    <input id="settings-search-input" ref={inputRef} type="search" value={query}
      placeholder={language === 'zh-CN' ? '分类、子页或字段' : 'Category, page, or field'}
      onChange={event => { setQuery(event.target.value); setActiveIndex(0) }}
      onKeyDown={event => {
        if (event.key === 'Escape') setQuery('')
        if (event.key === 'ArrowDown' && results.length) { event.preventDefault(); setActiveIndex(Math.min(selectedIndex + 1, results.length - 1)) }
        if (event.key === 'ArrowUp' && results.length) { event.preventDefault(); setActiveIndex(Math.max(selectedIndex - 1, 0)) }
        if (event.key === 'Enter' && selectedIndex >= 0) { event.preventDefault(); choose(results[selectedIndex]) }
      }}
      role="combobox" aria-autocomplete="list" aria-controls="settings-search-results" aria-expanded={Boolean(normalized)}
      aria-activedescendant={selectedIndex >= 0 ? `settings-search-option-${selectedIndex}` : undefined} />
    {normalized && <div id="settings-search-results" className="settings-search-results" role="listbox"
      aria-label={language === 'zh-CN' ? '设置搜索结果' : 'Settings search results'}>
      {results.length ? results.map((entry, index) => <button key={entry.id} id={`settings-search-option-${index}`} type="button" role="option" aria-selected={index === selectedIndex}
        onClick={() => choose(entry)}>
        <strong>{entry.label}</strong><span>{entry.context}</span>
      </button>) : !loading && <p>{language === 'zh-CN' ? '没有匹配的设置' : 'No matching settings'}</p>}
      {loading && <small>{language === 'zh-CN' ? '正在读取当前 Profile 的字段目录；分类和子页已可搜索。' : 'Loading this Profile’s field catalog; categories and pages are available now.'}</small>}
      {loadFailed && <small>{language === 'zh-CN' ? '字段目录读取失败，目前仅能搜索分类和子页。' : 'Field catalog unavailable; search is limited to categories and pages.'}</small>}
    </div>}
  </div>
}
