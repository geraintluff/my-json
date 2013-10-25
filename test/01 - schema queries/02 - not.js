var assert = require('chai').assert;
var myJson = require('../../main');

describe('not queries', function () {
	it('not enum', function () {
		var TestClass = myJson({
			table: 'TestTable',
			columns: {
				'integer/id': 'id',
				'string/name': 'name'
			}
		});
		
		var schema = {
			not: {
				type: 'object',
				properties: {
					'id': {'enum': [5]}
				}
			}
		};
		var sql = TestClass.sqlFromSchema(schema);
		assert.isString(sql);

		assert.isTrue(myJson.sqlMatchPattern(sql, 'SELECT {t}.* FROM `TestTable` {t} WHERE {t}.`id` != 5'), sql);
	});
});
