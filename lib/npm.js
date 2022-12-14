import fs from 'fs'
import { join, resolve } from 'path'
import { execSync } from 'child_process'

export default class npm {
  constructor(token, registry = 'registry.npmjs.org') {
    if (!token || token.trim().length === 0) {
      throw new Error('Missing REGISTRY_TOKEN.')
    }

    this.token = token
    this.registry = registry || 'registry.npmjs.org'
  }

  latest (module) {
    const result = JSON.parse(execSync(`npm info ${module} --json`).toString())
    return result['dist-tags'].latest
  }

  publish (dir, forcePublic = true) {
    this.run(dir, `npm publish${forcePublic ? ' --access=public' : ''}`)
  }

  tag (dir, name, version, alias) {
    this.run(dir, `npm dist-tag add ${name}@${version} ${alias}`)
  }

  run (dir, cmd) {
    this.config(dir)
    const response = execSync(cmd, { cwd: dir }).toString()

    if (response.indexOf('npm ERR!') >= 0) {
      console.log('DEBUG: ' + response.split('\n').join('\nDEBUG: '))

      throw new Error(response)
    }
  }

  config (dir) {
    dir = resolve(dir)

    let npmrc = this.npmrc(dir)
    let npmrcFile = join(dir, '.npmrc')

    if (fs.existsSync(npmrcFile)) {
      fs.unlinkSync(npmrcFile)
    }
    console.log('Writing to', npmrcFile)
    console.log('npmrc content: ', npmrc.replace(this.token, 'TOKEN'))
    console.log('------')
    fs.writeFileSync(npmrcFile, npmrc)
  }

  npmrc (dir) {
    const file = join(dir, '.npmrc')

    if (!fs.existsSync(file)) {
      return `//${this.registry}/:_authToken=${this.token}`
    }

    let content = fs.readFileSync(file).toString()
    let hasRegistry = false

    content = content.split(/\n+/).map(line => {
      const match = /(\/{2}[\S]+\/:?)/.exec(line)

      if (match !== null) {
        hasRegistry = true
        line = `${match[1]}:`.replace(/:+$/, ':') + `_authToken=${this.token}`
      }

      return line
    }).join('\n').trim()

    if (!hasRegistry) {
      content += `\n//${this.registry}/:_authToken=${this.token}`
    }

    return content.trim()
  }
}
