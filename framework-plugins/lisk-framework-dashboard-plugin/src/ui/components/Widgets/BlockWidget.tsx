/*
 * Copyright © 2021 Lisk Foundation
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Unless otherwise agreed in a custom licensing agreement with the Lisk Foundation,
 * no part of this software, including this file, may be copied, modified,
 * propagated, or distributed except according to the terms contained in the
 * LICENSE file.
 *
 * Removal or modification of this copyright notice is prohibited.
 */
import * as React from 'react';
import { TableBody, TableHeader } from '../Table';
import Grid from '../Grid';
import CopiableText from '../CopiableText';
import { Widget, WidgetHeader, WidgetBody } from '../widget';
import Text from '../Text';

interface WidgetProps {
	scrollbar?: boolean;
	data: Record<string, string>[];
	widgetTitle: string;
}

const BlockWidget: React.FC<WidgetProps> = props => {
	if (props.data.length === 0) return null;

	const scrollbar = props.scrollbar ?? true;
	const { data, widgetTitle } = props;

	return (
		<Widget>
			<WidgetHeader>
				<Text type={'h2'}>{widgetTitle}</Text>
			</WidgetHeader>
			<WidgetBody>
				<TableHeader>
					<Grid rowNoWrap>
						<Grid xs={5}>
							<Text type={'th'}>Id</Text>
						</Grid>
						<Grid xs={4}>
							<Text type={'th'}>Generated by</Text>
						</Grid>
						<Grid xs={2}>
							<Text type={'th'}>Height</Text>
						</Grid>
						<Grid xs={1}>
							<Text type={'th'}>Txs</Text>
						</Grid>
					</Grid>
				</TableHeader>
				<TableBody size={'m'} scrollbar={scrollbar}>
					{data.map(item => (
						<Grid rowNoWrap>
							<Grid xs={5}>
								<CopiableText text={item.id} type={'p'}>
									{item.id}
								</CopiableText>
							</Grid>
							<Grid xs={4}>
								<CopiableText text={item.generatedBy} type={'p'}>
									{item.generatedBy}
								</CopiableText>
							</Grid>
							<Grid xs={2}>
								<Text type={'p'} key={item.height}>
									{item.height}
								</Text>
							</Grid>
							<Grid xs={1}>
								<Text type={'p'} key={item.txs}>
									{item.txs}
								</Text>
							</Grid>
						</Grid>
					))}
				</TableBody>
			</WidgetBody>
		</Widget>
	);
};

export default BlockWidget;
