const json = require('@rollup/plugin-json')
module.exports = {
	input: 'src/Comlink.js',
	output: {
		dir: 'dist'
	},
	plugins: {
		json: json()
	}
}
