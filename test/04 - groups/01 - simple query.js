var assert = require('chai').assert;
var myJson = require('../../main');

describe('Class groups', function () {
	it('define MyJSON class groups', function () {
		var classes = myJson.group({
			TestClass: {
				table: 'TestTable',
				columns: {
					'integer/id': 'id',
					'string/name': 'name'
				}
			}
		});
		
		assert.isFunction(classes.TestClass);
	});
});
