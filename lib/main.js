import * as core from '@actions/core'
// const github = require('@actions/github')
import globby from 'globby'
import fs from 'fs'
import path from 'path'
// const execSync = require('child_process').execSync
import NpmRegistry from './npm.js'

const SEMVER_PATTERN = /(?<main>(?<major>[0-9]+)\.(?<minor>[0-9]+)\.(?<patch>[0-9]+))(-(?<prerelease>.+))?/i

async function run() {
  try {
    core.debug(
      ` Available environment variables:\n -> ${Object.keys(process.env)
        .map(i => i + ' :: ' + process.env[i])
        .join('\n -> ')}`
    )

    if (!process.env.hasOwnProperty('REGISTRY_TOKEN')) {
      core.setFailed('Missing REGISTRY_TOKEN.')
      return
    }

    const token = process.env.REGISTRY_TOKEN
    const dist_tag = {
      prerelease: (core.getInput('prerelease_dist_tag', { required: true }) || '').split(',').map(i => i.trim()),
      latest: (core.getInput('dist_tag', { required: false }) || '').split(',').map(i => i.trim())
    }
    const force = (core.getInput('force', { required: false }) || 'false').trim().toLowerCase() === 'true' ? true : false
    const scan = (core.getInput('scan', { required: false }) || './').split(',').map(dir => path.join(process.env.GITHUB_WORKSPACE, dir.trim(), '/**/package.json'))
    const ignore = new Set()
    const ignoreList = core.getInput('ignore', { required: false }).trim().split(',')

    if (ignoreList.length > 0) {
      (await globby(
        ignoreList
          .filter(dir => dir.trim().length > 0)
          .map(dir => path.join(process.env.GITHUB_WORKSPACE, dir.trim(), '/**/package.json'))
      ))
      .forEach(result => ignore.add(result))
    }

    console.log(`Directories to scan:\n\t- ${scan.join('\n\t- ')}`)

    const npm = new NpmRegistry(token, core.getInput('registry', { required: false }))

    // Scan for modules
    const test = await globby(scan.concat(['!**/node_modules']))
    const paths = new Set(await globby(scan.concat(['!**/node_modules'])))

    // Remove ignored directories
    if (ignore.size > 0) {
      core.debug('Ignored:', ignore)
      ignore.forEach(file => paths.has(file) && paths.delete(file))
    }

    if (paths.size === 0) {
      core.debug('Paths:\n' + Array.from(paths).join('\n'))
      core.setFailed('No modules detected in the code base (could not find package.json).')
      return
    }

    let publications = new Set()

    paths.forEach(async file => {
      file = path.resolve(file)
      console.log(`Attempting to publish from "${file}"`)
      const content = JSON.parse(fs.readFileSync(file))

      // Do not publish private packages unless forced
      if (force === true || !content.private) {
        try {
          const latest = await npm.latest(content.name)
          npm.publish(path.dirname(file), force === true ? true : !content.private)
          publications.add(`${content.name}@${content.version}`)
          const match = SEMVER_PATTERN.exec(content.version)
          if (match?.groups) {
            const { prerelease } = match.groups
            if (prerelease && prerelease.trim().length > 0) {
              for (const ptag of dist_tag.prerelease) {
                npm.tag(path.dirname(file), content.name, content.version, ptag)
                // Assure the prior latest tag remains intact
                npm.tag(path.dirname(file), content.name, latest, 'latest')
                core.info(`tagged ${content.name}@${content.version} as "${ptag}"`)
              }
            } else if (dist_tag.latest) {
              for (const dtag of dist_tag.latest) {
                npm.tag(path.dirname(file), content.name, content.version, dtag)
                core.info(`tagged ${content.name}@${content.version} as "${dtag}"`)
              }
            }
          }
        } catch (e) {
          core.warning(e.message)
        }
      } else {
        core.notice(`Skipped publishing ${path.dirname(file)} to ${npm.registry} (private module).`)
      }
    })

    if (publications.size === 0) {
      core.setFailed('Did not successfully publish any modules.')
      return
    }

    core.setOutput('modules', Array.from(publications).join(', '))
  } catch (e) {
    core.setFailed(e.message)
  }
}

run()
